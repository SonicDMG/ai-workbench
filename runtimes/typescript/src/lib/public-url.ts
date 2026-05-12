/**
 * Resolve the externally reachable base URL for an inbound request.
 *
 * Most surfaces inside the runtime can use `new URL(req.url).origin` —
 * but two cases need help:
 *
 *   - **Dev:** the Vite dev server proxies `/api/*` to `:8080`, but
 *     external clients (Claude Code, Cursor, an MCP-aware LangGraph
 *     node) don't go through the proxy. They need the runtime's own
 *     origin, not the browser's.
 *   - **Prod:** a TLS-terminating load balancer in front of an HTTP
 *     runtime makes `req.url` look like `http://internal:8080/...`,
 *     which is useless to surface to a user. We honour the standard
 *     reverse-proxy headers so the displayed URL is the one a customer
 *     can actually reach.
 *
 * Order of precedence: `Forwarded` (RFC 7239) > `X-Forwarded-*` > the
 * inbound URL itself.
 *
 * Pure function over `Request.headers` + `Request.url`; no I/O.
 */
export function resolvePublicBaseUrl(req: Request): string {
	const headers = req.headers;
	const forwarded = headers.get("forwarded");
	if (forwarded) {
		const parts = forwarded.split(";").map((p) => p.trim());
		const protoPart = parts.find((p) => /^proto=/i.test(p));
		const hostPart = parts.find((p) => /^host=/i.test(p));
		const proto = protoPart?.split("=")[1]?.replace(/"/g, "");
		const host = hostPart?.split("=")[1]?.replace(/"/g, "");
		if (proto && host) return `${proto}://${host}`;
	}
	const xfHost = headers.get("x-forwarded-host");
	const xfProto = headers.get("x-forwarded-proto");
	if (xfHost) {
		const proto = xfProto?.split(",")[0]?.trim() || "https";
		return `${proto}://${xfHost.split(",")[0]?.trim()}`;
	}
	const url = new URL(req.url);
	return `${url.protocol}//${url.host}`;
}
