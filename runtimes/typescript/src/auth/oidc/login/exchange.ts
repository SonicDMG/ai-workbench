/**
 * Thin wrapper around the OIDC token endpoint.
 *
 * Three flows are exposed:
 *
 * - {@link exchangeAuthorizationCode} runs the initial
 *   `grant_type=authorization_code` flow at `/auth/callback`.
 * - {@link refreshAccessToken} runs `grant_type=refresh_token` from
 *   `POST /auth/refresh` (Phase 3c silent refresh). Caller passes the
 *   refresh_token decoded out of the existing session cookie.
 * - {@link pollDeviceCode} runs `grant_type=urn:ietf:params:oauth:
 *   grant-type:device_code` for RFC 8628 — proxied by
 *   `POST /auth/device/token`. Pending / slow-down / expired status
 *   is surfaced as `error` on the {@link DeviceTokenOutcome} envelope
 *   so the route layer can pass the IdP's response through verbatim
 *   (the polling client decides when to retry vs. give up).
 *
 * The session cookie now carries the refresh_token alongside the
 * access_token. Both ride inside the encrypted payload — same trust
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

/**
 * IdP response to a `device_authorization_endpoint` POST per RFC 8628
 * §3.2. `verification_uri_complete` is a Google extension carried
 * by most modern IdPs (Auth0, Okta, Keycloak); when present the
 * caller can render a QR code or auto-open the browser with the
 * code pre-filled. `verification_uri` (plain) is mandatory.
 */
export interface DeviceAuthorizationResponse {
	readonly device_code: string;
	readonly user_code: string;
	readonly verification_uri: string;
	readonly verification_uri_complete?: string;
	readonly expires_in: number;
	readonly interval?: number;
}

export interface RequestDeviceAuthorizationOptions {
	readonly deviceAuthorizationEndpoint: string;
	readonly clientId: string;
	readonly scopes: readonly string[];
	readonly fetchImpl?: FetchLike;
}

/**
 * Call the IdP's device-authorization endpoint to start a device
 * grant. Returns the raw IdP envelope (caller forwards it to the
 * CLI verbatim).
 */
export async function requestDeviceAuthorization(
	opts: RequestDeviceAuthorizationOptions,
): Promise<DeviceAuthorizationResponse> {
	const body = new URLSearchParams({
		client_id: opts.clientId,
		scope: opts.scopes.join(" "),
	});
	const fetchFn = opts.fetchImpl ?? fetch;
	const res = await fetchFn(opts.deviceAuthorizationEndpoint, {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded",
		},
		body: body.toString(),
	});
	const text = await res.text();
	if (!res.ok) {
		let code = "device_authorize_failed";
		try {
			const parsed = JSON.parse(text) as { error?: unknown };
			if (typeof parsed.error === "string") code = parsed.error;
		} catch {
			// keep default
		}
		throw new Error(`device authorization failed (${res.status} ${code})`);
	}
	const parsed = JSON.parse(text) as unknown;
	if (
		!parsed ||
		typeof parsed !== "object" ||
		typeof (parsed as { device_code?: unknown }).device_code !== "string" ||
		typeof (parsed as { user_code?: unknown }).user_code !== "string" ||
		typeof (parsed as { verification_uri?: unknown }).verification_uri !==
			"string"
	) {
		throw new Error(
			"device authorization response missing device_code / user_code / verification_uri",
		);
	}
	return parsed as DeviceAuthorizationResponse;
}

/**
 * Outcome envelope for one poll of the token endpoint with the
 * device-code grant. `pending: true` shapes capture RFC 8628 §3.5
 * status codes (`authorization_pending`, `slow_down`); the caller
 * keeps polling. `pending: false` is the terminal outcome — either
 * a token (success) or a recognized error like `expired_token` /
 * `access_denied`. The route layer surfaces the envelope to the
 * CLI as-is so the polling logic lives on the client.
 */
export type DeviceTokenOutcome =
	| { readonly kind: "success"; readonly tokens: TokenResponse }
	| {
			readonly kind: "pending";
			readonly error: string;
			readonly retryAfterIncrease: boolean;
	  }
	| {
			readonly kind: "error";
			readonly error: string;
			readonly httpStatus: number;
	  };

export interface PollDeviceCodeOptions {
	readonly tokenEndpoint: string;
	readonly clientId: string;
	readonly clientSecret: string | null;
	readonly deviceCode: string;
	readonly fetchImpl?: FetchLike;
}

const DEVICE_PENDING_ERRORS = new Set(["authorization_pending", "slow_down"]);

/**
 * Poll the IdP's token endpoint with the device-code grant. Mirrors
 * the `Basic` auth shape used by {@link exchangeAuthorizationCode} so
 * a confidential client still works for the device flow.
 *
 * RFC 8628 §3.5 status codes are normalized:
 *   - 200 with `access_token`  → `{ kind: "success" }`.
 *   - 400 with `authorization_pending` / `slow_down` →
 *     `{ kind: "pending" }`. `retryAfterIncrease` is true for
 *     `slow_down`, telling the caller to extend the polling interval.
 *   - Any other non-2xx → `{ kind: "error" }` with the IdP-supplied
 *     error code (e.g. `expired_token`, `access_denied`,
 *     `invalid_grant`).
 */
export async function pollDeviceCode(
	opts: PollDeviceCodeOptions,
): Promise<DeviceTokenOutcome> {
	const body = new URLSearchParams({
		grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		device_code: opts.deviceCode,
		client_id: opts.clientId,
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

	if (res.ok) {
		const parsed = JSON.parse(text) as unknown;
		if (
			!parsed ||
			typeof parsed !== "object" ||
			typeof (parsed as { access_token?: unknown }).access_token !== "string"
		) {
			return {
				kind: "error",
				error: "missing_access_token",
				httpStatus: res.status,
			};
		}
		return { kind: "success", tokens: parsed as TokenResponse };
	}

	let errorCode = "device_token_failed";
	try {
		const parsed = JSON.parse(text) as { error?: unknown };
		if (typeof parsed.error === "string") errorCode = parsed.error;
	} catch {
		// Body wasn't JSON; fall through with the default code.
	}

	if (DEVICE_PENDING_ERRORS.has(errorCode)) {
		return {
			kind: "pending",
			error: errorCode,
			retryAfterIncrease: errorCode === "slow_down",
		};
	}
	return { kind: "error", error: errorCode, httpStatus: res.status };
}
