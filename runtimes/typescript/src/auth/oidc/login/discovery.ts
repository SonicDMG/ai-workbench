/**
 * OIDC discovery for the browser-login flow.
 *
 * The verifier only needs `jwks_uri`; the browser-login flow
 * additionally needs `authorization_endpoint`, `token_endpoint`, and
 * optionally `end_session_endpoint` for RP-initiated logout.
 *
 * The CLI device-flow (RFC 8628) needs `device_authorization_endpoint`
 * — surfaced as optional because not every IdP advertises it. When
 * absent, the `/auth/device/*` proxy endpoints respond with a clean
 * 501 so callers see "this IdP doesn't speak device flow" instead of
 * a generic crash.
 */

export interface OidcEndpoints {
	readonly authorizationEndpoint: string;
	readonly tokenEndpoint: string;
	readonly endSessionEndpoint: string | null;
	readonly jwksUri: string;
	readonly deviceAuthorizationEndpoint: string | null;
}

export type FetchLike = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface FetchEndpointsOptions {
	readonly issuer: string;
	readonly fetchImpl?: FetchLike;
}

export async function fetchOidcEndpoints(
	opts: FetchEndpointsOptions,
): Promise<OidcEndpoints> {
	const url = `${opts.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
	const fetchFn = opts.fetchImpl ?? fetch;
	const res = await fetchFn(url);
	if (!res.ok) {
		throw new Error(`OIDC discovery failed: GET ${url} returned ${res.status}`);
	}
	const doc = (await res.json()) as Record<string, unknown>;
	const authorizationEndpoint = str(doc, "authorization_endpoint");
	const tokenEndpoint = str(doc, "token_endpoint");
	const jwksUri = str(doc, "jwks_uri");
	const endSessionEndpoint =
		typeof doc.end_session_endpoint === "string"
			? doc.end_session_endpoint
			: null;
	const deviceAuthorizationEndpoint =
		typeof doc.device_authorization_endpoint === "string"
			? doc.device_authorization_endpoint
			: null;
	return {
		authorizationEndpoint,
		tokenEndpoint,
		endSessionEndpoint,
		jwksUri,
		deviceAuthorizationEndpoint,
	};
}

function str(doc: Record<string, unknown>, field: string): string {
	const v = doc[field];
	if (typeof v !== "string" || v.length === 0) {
		throw new Error(`OIDC discovery document is missing '${field}'`);
	}
	return v;
}
