/**
 * Browser OIDC login flow (Phase 3b).
 *
 * Five endpoints mounted under `/auth`:
 *
 *   GET  /auth/config    — what the UI should offer: oidc? apiKey?
 *   GET  /auth/login     — 302 to the IdP's authorization endpoint
 *   GET  /auth/callback  — exchange code, set session cookie, redirect
 *   GET  /auth/me        — current session subject, or 401
 *   POST /auth/logout    — clear the cookie, redirect
 *
 * The flow is authorization-code-with-PKCE (RFC 7636) regardless of
 * whether a client secret is configured; PKCE is cheap and closes a
 * specific class of code-interception attacks. State binds the
 * callback to the login it came from; the PKCE verifier is kept in
 * an in-process `PendingLoginStore` and consumed at callback time.
 */

import { type Context, Hono } from "hono";
import type { CookieSigner } from "../auth/oidc/login/cookie.js";
import { parseCookie, serializeCookie } from "../auth/oidc/login/cookie.js";
import type { OidcEndpoints } from "../auth/oidc/login/discovery.js";
import { exchangeAuthorizationCode } from "../auth/oidc/login/exchange.js";
import type { PendingLoginStore } from "../auth/oidc/login/pending.js";
import {
	challengeFor,
	generateState,
	generateVerifier,
} from "../auth/oidc/login/pkce.js";
import type { AuthResolver } from "../auth/resolver.js";
import type { AuthConfig } from "../config/schema.js";
import { logger } from "../lib/logger.js";
import type { AppEnv } from "../lib/types.js";

export interface AuthLoginRoutesOptions {
	readonly auth: AuthResolver;
	readonly config: AuthConfig;
	readonly endpoints: OidcEndpoints | null;
	readonly clientSecret: string | null;
	readonly cookie: CookieSigner | null;
	readonly pending: PendingLoginStore | null;
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
		});
	});

	// The login-related routes only make sense when an OIDC client is
	// configured. Register them as 404-emitters otherwise so the UI
	// gets a clean answer instead of silently wrong behavior.
	const clientCfg = opts.config.oidc?.client;
	if (!clientCfg || !opts.endpoints || !opts.cookie || !opts.pending) {
		for (const p of ["/login", "/callback", "/me", "/logout"]) {
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

		const redirectUri = absoluteRedirectUri(c, clientCfg.redirectPath);
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
				redirectUri: absoluteRedirectUri(c, clientCfg.redirectPath),
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
			return c.json({ error: { code: "token_validation_failed" } }, 502);
		}

		const value = cookie.sign({
			accessToken: tokens.access_token,
			issuedAt: Math.floor(Date.now() / 1000),
			idToken: tokens.id_token,
		});
		const maxAge = tokens.expires_in ?? 3600;
		c.header(
			"Set-Cookie",
			serializeCookie({
				name: clientCfg.sessionCookieName,
				value: encodeURIComponent(value),
				maxAgeSeconds: maxAge,
				httpOnly: true,
				secure: isSecure(c),
				sameSite: "Lax",
			}),
		);
		return c.redirect(pendingEntry.redirectAfter, 302);
	});

	app.get("/me", (c) => {
		const auth = c.get("auth");
		if (!auth?.authenticated || !auth.subject) {
			return c.json({ error: { code: "unauthorized" } }, 401);
		}
		return c.json({
			id: auth.subject.id,
			label: auth.subject.label,
			type: auth.subject.type,
			workspaceScopes: auth.subject.workspaceScopes,
		});
	});

	app.post("/logout", (c) => {
		c.header(
			"Set-Cookie",
			serializeCookie({
				name: clientCfg.sessionCookieName,
				value: "",
				maxAgeSeconds: 0,
				httpOnly: true,
				secure: isSecure(c),
				sameSite: "Lax",
			}),
		);
		return c.json({ postLogoutPath: clientCfg.postLogoutPath });
	});

	return app;
}

/**
 * Read the session cookie off a request and return the signed access
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

function absoluteRedirectUri(c: Context<AppEnv>, path: string): string {
	if (/^https?:\/\//i.test(path)) return path;
	const proto =
		c.req.header("x-forwarded-proto") ??
		(new URL(c.req.url).protocol === "https:" ? "https" : "http");
	const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
	if (!host) return path;
	return `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

function isSecure(c: Context<AppEnv>): boolean {
	const proto = c.req.header("x-forwarded-proto");
	if (proto) return proto.includes("https");
	return new URL(c.req.url).protocol === "https:";
}
