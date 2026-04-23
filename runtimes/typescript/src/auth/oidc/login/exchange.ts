/**
 * Thin wrapper around the OIDC token endpoint.
 *
 * The runtime never keeps refresh_tokens in the cookie — the session
 * cookie only carries the access token. When it expires the user
 * re-logs-in. That's deliberate: it means there's no server-side
 * session table to worry about and no long-lived secret riding around
 * in the browser. Silent refresh lands in Phase 3c when it's needed.
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
