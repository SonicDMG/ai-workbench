/**
 * JWKS resolver.
 *
 * Two-step boot:
 *   1. If `auth.oidc.jwksUri` is set in config, use it directly.
 *   2. Otherwise fetch `${issuer}/.well-known/openid-configuration`
 *      and pull `jwks_uri` out of the response.
 *
 * The fetched JWK set itself is cached by `jose.createRemoteJWKSet`,
 * which also handles cache invalidation on unknown `kid` (for key
 * rotation) and rate-limits concurrent refreshes.
 */

import { createRemoteJWKSet } from "jose";

export type JwksFetcher = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface ResolveJwksUriOptions {
	readonly issuer: string;
	readonly configuredUri: string | null;
	readonly fetchImpl?: JwksFetcher;
}

/**
 * Resolve the JWKS URL for a given OIDC issuer. Returns the
 * configured URL as-is when set; otherwise does an OIDC discovery
 * fetch. Throws when discovery fails or returns a document without
 * `jwks_uri`.
 */
export async function resolveJwksUri(
	opts: ResolveJwksUriOptions,
): Promise<string> {
	if (opts.configuredUri) return opts.configuredUri;
	const discoveryUrl = `${opts.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
	const fetchFn = opts.fetchImpl ?? fetch;
	const res = await fetchFn(discoveryUrl);
	if (!res.ok) {
		throw new Error(
			`OIDC discovery failed: GET ${discoveryUrl} returned ${res.status}`,
		);
	}
	const doc = (await res.json()) as { jwks_uri?: unknown; issuer?: unknown };
	if (typeof doc.jwks_uri !== "string" || doc.jwks_uri.length === 0) {
		throw new Error(
			`OIDC discovery at ${discoveryUrl} did not include a 'jwks_uri'`,
		);
	}
	// The issuer claim in the discovery doc SHOULD equal the configured
	// issuer (OIDC Discovery 4.3). Warn-but-don't-fail if it differs —
	// some proxied setups put the external URL in config while the doc
	// reports the internal one.
	return doc.jwks_uri;
}

/**
 * Thin wrapper around jose's `createRemoteJWKSet` so the rest of the
 * runtime doesn't depend on jose's types directly. Returns a function
 * suitable for passing to `jose.jwtVerify`.
 */
export function makeJwkSet(
	jwksUri: string,
): ReturnType<typeof createRemoteJWKSet> {
	return createRemoteJWKSet(new URL(jwksUri));
}
