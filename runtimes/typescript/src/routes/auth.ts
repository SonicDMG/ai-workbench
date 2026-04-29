/**
 * Browser OIDC login flow.
 *
 * Six endpoints mounted under `/auth`:
 *
 *   GET  /auth/config    — what the UI should offer: oidc? apiKey?
 *   GET  /auth/login     — 302 to the IdP's authorization endpoint
 *   GET  /auth/callback  — exchange code, set session cookie, redirect
 *   GET  /auth/me        — current session subject, or 401
 *   POST /auth/refresh   — swap refresh_token for a fresh cookie (3c)
 *   POST /auth/logout    — clear the cookie, redirect
 *
 * The flow is authorization-code-with-PKCE (RFC 7636) regardless of
 * whether a client secret is configured; PKCE is cheap and closes a
 * specific class of code-interception attacks. State binds the
 * callback to the login it came from; the PKCE verifier is kept in
 * an in-process `PendingLoginStore` and consumed at callback time.
 *
 * Phase 3c — silent refresh:
 * - `/auth/callback` now persists `tokens.refresh_token` (when the
 *   IdP returns one) into the encrypted session cookie alongside the
 *   access token. Same trust boundary; same HttpOnly + authenticated
 *   envelope.
 * - `/auth/refresh` reads the cookie, calls the IdP's token endpoint
 *   with `grant_type=refresh_token`, and re-issues the cookie
 *   without a browser redirect. The UI calls it ahead of access-
 *   token expiry and (as a fallback) on a 401.
 * - `/auth/me` now exposes `expiresAt` (read out of the JWT's `exp`
 *   claim) so the UI can schedule the refresh without decoding the
 *   token client-side.
 */

import { type Context, Hono } from "hono";
import { decodeJwt } from "jose";
import type { CookieSigner } from "../auth/oidc/login/cookie.js";
import { parseCookie, serializeCookie } from "../auth/oidc/login/cookie.js";
import type { OidcEndpoints } from "../auth/oidc/login/discovery.js";
import {
	exchangeAuthorizationCode,
	refreshAccessToken,
} from "../auth/oidc/login/exchange.js";
import type { PendingLoginStore } from "../auth/oidc/login/pending.js";
import {
	challengeFor,
	generateState,
	generateVerifier,
} from "../auth/oidc/login/pkce.js";
import type { AuthResolver } from "../auth/resolver.js";
import type { AuthConfig } from "../config/schema.js";
import { audit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import type { AppEnv } from "../lib/types.js";

export interface AuthLoginRoutesOptions {
	readonly auth: AuthResolver;
	readonly config: AuthConfig;
	readonly endpoints: OidcEndpoints | null;
	readonly clientSecret: string | null;
	readonly cookie: CookieSigner | null;
	readonly pending: PendingLoginStore | null;
	readonly publicOrigin: string | null;
	readonly trustProxyHeaders: boolean;
}

const SAFE_PATH_RE = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/;

export function authLoginRoutes(opts: AuthLoginRoutesOptions): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	// Tell the UI what methods are available so it can render the
	// right buttons. Always reachable — also under `anonymousPolicy:
	// reject`, since the UI calls it before it has any credentials.
	app.get("/config", (c) => {
		const { mode } = opts.config;
		const hasOidcLogin =
			(mode === "oidc" || mode === "any") &&
			opts.config.oidc?.client !== undefined;
		return c.json({
			modes: {
				apiKey: mode === "apiKey" || mode === "any",
				oidc: mode === "oidc" || mode === "any",
				login: hasOidcLogin,
			},
			loginPath: hasOidcLogin ? "/auth/login" : null,
			// Phase 3c: advertised so the UI knows to schedule silent
			// refresh and to attempt one on a 401. Tied to login config —
			// if browser login isn't wired up, refresh isn't either.
			refreshPath: hasOidcLogin ? "/auth/refresh" : null,
		});
	});

	// The login-related routes only make sense when an OIDC client is
	// configured. Register them as 404-emitters otherwise so the UI
	// gets a clean answer instead of silently wrong behavior.
	const clientCfg = opts.config.oidc?.client;
	if (!clientCfg || !opts.endpoints || !opts.cookie || !opts.pending) {
		for (const p of ["/login", "/callback", "/me", "/refresh", "/logout"]) {
			app.all(p, (c) => c.json({ error: { code: "not_configured" } }, 404));
		}
		return app;
	}

	const pending = opts.pending;
	const cookie = opts.cookie;
	const endpoints = opts.endpoints;

	app.get("/login", (c) => {
		const state = generateState();
		const nonce = generateState();
		const verifier = generateVerifier();
		const challenge = challengeFor(verifier);

		const rawRedirect = c.req.query("redirect_after");
		const redirectAfter = sanitizeRedirect(rawRedirect);
		pending.put(state, {
			verifier,
			nonce,
			redirectAfter,
			createdAt: Date.now(),
		});

		const redirectUri = absoluteRedirectUri(c, clientCfg.redirectPath, opts);
		const authorizeUrl = new URL(endpoints.authorizationEndpoint);
		authorizeUrl.searchParams.set("response_type", "code");
		authorizeUrl.searchParams.set("client_id", clientCfg.clientId);
		authorizeUrl.searchParams.set("redirect_uri", redirectUri);
		authorizeUrl.searchParams.set("scope", clientCfg.scopes.join(" "));
		authorizeUrl.searchParams.set("state", state);
		authorizeUrl.searchParams.set("nonce", nonce);
		authorizeUrl.searchParams.set("code_challenge", challenge);
		authorizeUrl.searchParams.set("code_challenge_method", "S256");

		return c.redirect(authorizeUrl.toString(), 302);
	});

	app.get("/callback", async (c) => {
		const error = c.req.query("error");
		if (error) {
			logger.warn({ error }, "oidc callback returned error from idp");
			return c.json({ error: { code: String(error) } }, 400);
		}
		const code = c.req.query("code");
		const state = c.req.query("state");
		if (!code || !state) {
			return c.json(
				{ error: { code: "invalid_callback", message: "missing code/state" } },
				400,
			);
		}
		const pendingEntry = pending.take(state);
		if (!pendingEntry) {
			return c.json(
				{
					error: { code: "invalid_state", message: "unknown or expired state" },
				},
				400,
			);
		}

		let tokens: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
		try {
			tokens = await exchangeAuthorizationCode({
				tokenEndpoint: endpoints.tokenEndpoint,
				clientId: clientCfg.clientId,
				clientSecret: opts.clientSecret,
				redirectUri: absoluteRedirectUri(c, clientCfg.redirectPath, opts),
				code,
				codeVerifier: pendingEntry.verifier,
			});
		} catch (err) {
			logger.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"oidc token exchange failed",
			);
			return c.json({ error: { code: "token_exchange_failed" } }, 502);
		}

		// Sanity-check that the access token actually passes the
		// existing verifier before we trust it. This re-uses the exact
		// same path a regular API request would take, so a valid
		// session cookie is, by construction, indistinguishable from a
		// bearer-auth header.
		try {
			const probe = new Request("http://local/auth/callback", {
				headers: { authorization: `Bearer ${tokens.access_token}` },
			});
			await opts.auth.authenticate(probe);
		} catch (err) {
			logger.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"oidc access token failed self-verification",
			);
			audit(c, {
				action: "auth.login",
				outcome: "failure",
				details: { scheme: "oidc", reason: "token_validation_failed" },
			});
			return c.json({ error: { code: "token_validation_failed" } }, 502);
		}

		setSessionCookie(c, cookie, clientCfg.sessionCookieName, tokens, opts);
		audit(c, {
			action: "auth.login",
			outcome: "success",
			details: { scheme: "oidc" },
		});
		return c.redirect(pendingEntry.redirectAfter, 302);
	});

	app.get("/me", (c) => {
		const auth = c.get("auth");
		if (!auth?.authenticated || !auth.subject) {
			return c.json({ error: { code: "unauthorized" } }, 401);
		}
		// Surface the access-token expiry so the UI can schedule a
		// silent refresh ahead of it. The verifier already validated
		// the token; here we just decode the unsigned `exp` claim.
		const cookieValue = parseCookie(
			c.req.header("cookie") ?? null,
			clientCfg.sessionCookieName,
		);
		const payload = cookieValue ? cookie.verify(cookieValue) : null;
		const expiresAt = payload ? jwtExpSecondsOrNull(payload.accessToken) : null;
		const canRefresh = Boolean(payload?.refreshToken);
		return c.json({
			id: auth.subject.id,
			label: auth.subject.label,
			type: auth.subject.type,
			workspaceScopes: auth.subject.workspaceScopes,
			expiresAt,
			canRefresh,
		});
	});

	app.post("/refresh", async (c) => {
		const cookieValue = parseCookie(
			c.req.header("cookie") ?? null,
			clientCfg.sessionCookieName,
		);
		const payload = cookieValue ? cookie.verify(cookieValue) : null;
		if (!payload?.refreshToken) {
			return c.json(
				{
					error: {
						code: "no_refresh_token",
						message: "no refresh_token in session — re-login required",
					},
				},
				401,
			);
		}

		let tokens: Awaited<ReturnType<typeof refreshAccessToken>>;
		try {
			tokens = await refreshAccessToken({
				tokenEndpoint: endpoints.tokenEndpoint,
				clientId: clientCfg.clientId,
				clientSecret: opts.clientSecret,
				refreshToken: payload.refreshToken,
				scopes: clientCfg.scopes,
			});
		} catch (err) {
			logger.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"oidc refresh failed",
			);
			// Clear the cookie — the refresh_token is dead from the IdP's
			// perspective; carrying it forward just produces another
			// failed refresh on the next attempt.
			clearSessionCookie(c, clientCfg.sessionCookieName, opts);
			return c.json(
				{
					error: {
						code: "refresh_failed",
						message: "refresh_token rejected by the IdP — re-login required",
					},
				},
				401,
			);
		}

		// Same self-verification gate as /callback: the new access
		// token must pass the runtime's own verifier before we trust it.
		try {
			const probe = new Request("http://local/auth/refresh", {
				headers: { authorization: `Bearer ${tokens.access_token}` },
			});
			await opts.auth.authenticate(probe);
		} catch (err) {
			logger.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"refreshed access token failed self-verification",
			);
			clearSessionCookie(c, clientCfg.sessionCookieName, opts);
			return c.json({ error: { code: "token_validation_failed" } }, 502);
		}

		setSessionCookie(c, cookie, clientCfg.sessionCookieName, tokens, opts, {
			// Some IdPs rotate refresh_tokens; some don't. If the
			// response omits one, keep the existing token so the next
			// refresh still works.
			fallbackRefreshToken: payload.refreshToken,
		});
		const expiresAt = jwtExpSecondsOrNull(tokens.access_token);
		audit(c, {
			action: "auth.refresh",
			outcome: "success",
			details: { scheme: "oidc" },
		});
		return c.json({ ok: true, expiresAt });
	});

	app.post("/logout", (c) => {
		c.header(
			"Set-Cookie",
			serializeCookie({
				name: clientCfg.sessionCookieName,
				value: "",
				maxAgeSeconds: 0,
				httpOnly: true,
				secure: isSecure(c, opts),
				sameSite: "Lax",
			}),
		);
		audit(c, {
			action: "auth.logout",
			outcome: "success",
			details: { scheme: "oidc" },
		});
		return c.json({ postLogoutPath: clientCfg.postLogoutPath });
	});

	return app;
}

/**
 * Read the session cookie off a request and return the encrypted access
 * token. Used by the AuthResolver when no Authorization header was
 * sent. Kept out of resolver.ts so resolver.ts stays mode-agnostic.
 */
export function sessionCookieAccessToken(
	req: Request,
	cookieName: string,
	cookie: CookieSigner,
): string | null {
	const header = req.headers.get("cookie");
	const raw = parseCookie(header, cookieName);
	if (!raw) return null;
	const payload = cookie.verify(raw);
	if (!payload) return null;
	return payload.accessToken;
}

function sanitizeRedirect(value: string | undefined): string {
	if (!value) return "/";
	if (!SAFE_PATH_RE.test(value)) return "/";
	// Explicitly reject protocol-relative and scheme URLs; SAFE_PATH_RE
	// already demands a leading `/`, but be belt-and-suspenders about
	// `//attacker.com` slipping through some future loosening.
	if (value.startsWith("//")) return "/";
	return value;
}

function absoluteRedirectUri(
	c: Context<AppEnv>,
	path: string,
	opts: Pick<AuthLoginRoutesOptions, "publicOrigin" | "trustProxyHeaders">,
): string {
	if (/^https?:\/\//i.test(path)) return path;
	if (opts.publicOrigin) {
		return new URL(
			path.startsWith("/") ? path : `/${path}`,
			opts.publicOrigin,
		).toString();
	}
	const proto =
		(opts.trustProxyHeaders ? c.req.header("x-forwarded-proto") : null) ??
		(new URL(c.req.url).protocol === "https:" ? "https" : "http");
	const host =
		(opts.trustProxyHeaders ? c.req.header("x-forwarded-host") : null) ??
		c.req.header("host");
	if (!host) return path;
	return `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

function isSecure(
	c: Context<AppEnv>,
	opts: Pick<AuthLoginRoutesOptions, "publicOrigin" | "trustProxyHeaders">,
): boolean {
	if (opts.publicOrigin) {
		return new URL(opts.publicOrigin).protocol === "https:";
	}
	const proto = opts.trustProxyHeaders
		? c.req.header("x-forwarded-proto")
		: null;
	if (proto) return proto.split(",")[0]?.trim() === "https";
	return new URL(c.req.url).protocol === "https:";
}

interface SetSessionCookieOptions {
	readonly fallbackRefreshToken?: string;
}

/**
 * Encrypt and emit the session cookie. Centralizes the Set-Cookie shape
 * so /callback (initial login) and /refresh (silent refresh) stay in
 * lockstep. Cookie max-age defaults to the IdP's `expires_in`; any
 * IdP-issued refresh_token rides inside the encrypted payload (or the
 * fallback when the IdP didn't rotate it).
 */
function setSessionCookie(
	c: Context<AppEnv>,
	cookie: CookieSigner,
	cookieName: string,
	tokens: {
		access_token: string;
		expires_in?: number;
		refresh_token?: string;
		id_token?: string;
	},
	security: Pick<AuthLoginRoutesOptions, "publicOrigin" | "trustProxyHeaders">,
	opts: SetSessionCookieOptions = {},
): void {
	const value = cookie.sign({
		accessToken: tokens.access_token,
		issuedAt: Math.floor(Date.now() / 1000),
		idToken: tokens.id_token,
		refreshToken: tokens.refresh_token ?? opts.fallbackRefreshToken,
	});
	const maxAge = tokens.expires_in ?? 3600;
	c.header(
		"Set-Cookie",
		serializeCookie({
			name: cookieName,
			value: encodeURIComponent(value),
			maxAgeSeconds: maxAge,
			httpOnly: true,
			secure: isSecure(c, security),
			sameSite: "Lax",
		}),
	);
}

function clearSessionCookie(
	c: Context<AppEnv>,
	cookieName: string,
	security: Pick<AuthLoginRoutesOptions, "publicOrigin" | "trustProxyHeaders">,
): void {
	c.header(
		"Set-Cookie",
		serializeCookie({
			name: cookieName,
			value: "",
			maxAgeSeconds: 0,
			httpOnly: true,
			secure: isSecure(c, security),
			sameSite: "Lax",
		}),
	);
}

/**
 * Read the `exp` claim out of an already-validated JWT and return it
 * as Unix seconds. The verifier has already passed at this point —
 * we're not re-validating, just exposing the expiry so the UI can
 * schedule its silent refresh. Returns null when the claim is
 * missing or the token isn't a JWT at all (some IdPs issue opaque
 * tokens; the runtime works with both).
 */
function jwtExpSecondsOrNull(token: string): number | null {
	try {
		const payload = decodeJwt(token);
		return typeof payload.exp === "number" ? payload.exp : null;
	} catch {
		return null;
	}
}
