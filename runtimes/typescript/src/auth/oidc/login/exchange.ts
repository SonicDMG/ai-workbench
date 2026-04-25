/**
 * Thin wrapper around the OIDC token endpoint.
 *
 * Two flows are exposed:
 *
 * - {@link exchangeAuthorizationCode} runs the initial
 *   `grant_type=authorization_code` flow at `/auth/callback`.
 * - {@link refreshAccessToken} runs `grant_type=refresh_token` from
 *   `POST /auth/refresh` (Phase 3c silent refresh). Caller passes the
 *   refresh_token decoded out of the existing session cookie.
 *
 * The session cookie now carries the refresh_token alongside the
 * access_token. Both ride inside the HMAC-signed payload — same trust
 * boundary as the access_token, which has always been there. See
 * {@link ../../../routes/auth.ts} and `docs/auth.md` for the threat-
 * model discussion (mainly: cookie theft was already game-over for
 * the active session; Phase 3c keeps that game-over window the same
 * length as the refresh_token's IdP-side lifetime).
 */

import type { FetchLike } from "./discovery.js";

export interface TokenResponse {
	readonly access_token: string;
	readonly token_type: string;
	readonly expires_in?: number;
	readonly refresh_token?: string;
	readonly id_token?: string;
	readonly scope?: string;
}

export interface ExchangeCodeOptions {
	readonly tokenEndpoint: string;
	readonly clientId: string;
	readonly clientSecret: string | null;
	readonly redirectUri: string;
	readonly code: string;
	readonly codeVerifier: string;
	readonly fetchImpl?: FetchLike;
}

/**
 * Exchange an authorization code for tokens. Sends `Basic` auth when
 * a client secret is configured, omits it for public clients. Throws
 * a sanitized error on any non-2xx.
 */
export async function exchangeAuthorizationCode(
	opts: ExchangeCodeOptions,
): Promise<TokenResponse> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code: opts.code,
		redirect_uri: opts.redirectUri,
		client_id: opts.clientId,
		code_verifier: opts.codeVerifier,
	});

	const headers: Record<string, string> = {
		accept: "application/json",
		"content-type": "application/x-www-form-urlencoded",
	};
	if (opts.clientSecret) {
		const basic = Buffer.from(
			`${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`,
			"utf8",
		).toString("base64");
		headers.authorization = `Basic ${basic}`;
	}

	const fetchFn = opts.fetchImpl ?? fetch;
	const res = await fetchFn(opts.tokenEndpoint, {
		method: "POST",
		headers,
		body: body.toString(),
	});
	const text = await res.text();
	if (!res.ok) {
		// IdP error bodies are typically `{error, error_description}` —
		// surface the error code but not the description (avoid echoing
		// anything that might include token fragments).
		let code = "token_exchange_failed";
		try {
			const parsed = JSON.parse(text) as { error?: unknown };
			if (typeof parsed.error === "string") code = parsed.error;
		} catch {
			// keep default
		}
		throw new Error(`token exchange failed (${res.status} ${code})`);
	}

	const parsed = JSON.parse(text) as unknown;
	if (
		!parsed ||
		typeof parsed !== "object" ||
		typeof (parsed as { access_token?: unknown }).access_token !== "string"
	) {
		throw new Error("token exchange response missing access_token");
	}
	return parsed as TokenResponse;
}

export interface RefreshTokenOptions {
	readonly tokenEndpoint: string;
	readonly clientId: string;
	readonly clientSecret: string | null;
	readonly refreshToken: string;
	/** Same scopes the original authorization grant requested. The IdP
	 * may issue a narrower set; we surface whatever it returns. */
	readonly scopes?: readonly string[];
	readonly fetchImpl?: FetchLike;
}

/**
 * Swap a refresh_token for a fresh access_token (and possibly a
 * rotated refresh_token, depending on the IdP). Same auth shape as
 * {@link exchangeAuthorizationCode} — `Basic` when a client secret is
 * configured, omitted otherwise.
 *
 * Throws on any non-2xx; the route layer maps that to a `401
 * refresh_failed` and clears the cookie.
 */
export async function refreshAccessToken(
	opts: RefreshTokenOptions,
): Promise<TokenResponse> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: opts.refreshToken,
		client_id: opts.clientId,
	});
	if (opts.scopes && opts.scopes.length > 0) {
		body.set("scope", opts.scopes.join(" "));
	}

	const headers: Record<string, string> = {
		accept: "application/json",
		"content-type": "application/x-www-form-urlencoded",
	};
	if (opts.clientSecret) {
		const basic = Buffer.from(
			`${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`,
			"utf8",
		).toString("base64");
		headers.authorization = `Basic ${basic}`;
	}

	const fetchFn = opts.fetchImpl ?? fetch;
	const res = await fetchFn(opts.tokenEndpoint, {
		method: "POST",
		headers,
		body: body.toString(),
	});
	const text = await res.text();
	if (!res.ok) {
		let code = "refresh_failed";
		try {
			const parsed = JSON.parse(text) as { error?: unknown };
			if (typeof parsed.error === "string") code = parsed.error;
		} catch {
			// keep default
		}
		throw new Error(`token refresh failed (${res.status} ${code})`);
	}

	const parsed = JSON.parse(text) as unknown;
	if (
		!parsed ||
		typeof parsed !== "object" ||
		typeof (parsed as { access_token?: unknown }).access_token !== "string"
	) {
		throw new Error("token refresh response missing access_token");
	}
	return parsed as TokenResponse;
}
