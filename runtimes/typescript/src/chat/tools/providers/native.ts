/**
 * Native tool provider (A3) — HTTP fetch + web search.
 *
 * Two agent-callable tools, both **opt-in** (per-agent `toolIds`
 * allow-list AND a config gate) and both **off by default**:
 *
 *  - `native:fetch` — GET/POST an arbitrary URL the model supplies.
 *    Guardrails, in order: a pre-flight host check rejecting private /
 *    loopback / link-local / cloud-metadata targets; outbound through
 *    {@link safeFetch} (`redirect: "error"`, closing the
 *    redirect-to-internal SSRF bypass); a hard timeout (AbortController);
 *    a streamed response-size cap (stop reading past N bytes); and a
 *    content-type allow-list (text / json / html). Errors are returned
 *    as an `Error: …` string — never thrown — so the model can
 *    self-correct on the next tool-call iteration.
 *
 *  - `native:web_search` — a pluggable search provider behind a config
 *    key. Built only when `chat.tools.webSearch` is enabled AND both a
 *    `provider` and `apiKeyRef` are configured; otherwise the tool is
 *    simply NOT returned (off). The API key is resolved at construction
 *    time via `ctx.secrets.resolve(ref)` and closed over — it never
 *    reaches the model.
 *
 * No code execution this release (documented non-goal).
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "@hono/zod-openapi";
import type {
	FetchToolConfig,
	WebSearchToolConfig,
} from "../../../config/schema.js";
import { safeFetch } from "../../../lib/safe-fetch.js";
import type { ToolDefinition } from "../../types.js";
import type { AgentTool, ToolProviderContext } from "../registry.js";

/** Stable, namespaced ids the allow-list and `toolset.resolve` match on. */
export const NATIVE_FETCH_TOOL_ID = "native:fetch";
export const NATIVE_WEB_SEARCH_TOOL_ID = "native:web_search";

/* ------------------------------ SSRF guard ------------------------------ */

/**
 * The config-write-time endpoint validator (`openapi/schemas.ts`) never
 * sees these URLs — the model supplies them at run time — so the fetch
 * tool does its own pre-flight host check. `safeFetch`'s
 * `redirect: "error"` is the second layer: it closes the
 * public-host-302→internal redirect-chain bypass this check can't see.
 *
 * Only `http`/`https` are allowed; literal-IP hosts are matched against
 * the blocked ranges; the cloud-metadata hostnames are denied by name.
 * A DNS *name* that resolves to a blocked IP is caught by
 * {@link resolvedSsrfRejectReason} (this sync check is its first pass),
 * which resolves the host and re-runs the range checks on every address.
 */
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function isBlockedIpv4(ip: string): boolean {
	const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
	if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
	const [a, b] = parts as [number, number, number, number];
	if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
	if (a === 127) return true; // loopback
	if (a === 0) return true; // "this" network
	if (a === 169 && b === 254) return true; // link-local + cloud metadata
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
	if (a === 192 && b === 168) return true; // 192.168.0.0/16
	if (a >= 224) return true; // multicast + reserved
	return false;
}

function isBlockedIpv6(ip: string): boolean {
	const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
	if (lower === "::1" || lower === "::") return true; // loopback / unspecified
	if (lower.startsWith("fe80") || lower.startsWith("fe9")) return true; // link-local
	if (lower.startsWith("fec")) return true; // site-local (deprecated)
	if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
	// IPv4-mapped (::ffff:a.b.c.d) — fall through to the v4 check.
	const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped?.[1]) return isBlockedIpv4(mapped[1]);
	return false;
}

/** Returns a reason string when the URL must be refused, else `null`. */
function ssrfRejectReason(rawUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return "not a valid absolute URL";
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return `unsupported protocol '${url.protocol.replace(/:$/, "")}' (only http/https)`;
	}
	const host = url.hostname.toLowerCase();
	if (BLOCKED_HOSTNAMES.has(host)) {
		return `host '${host}' is not allowed`;
	}
	// `URL.hostname` keeps the brackets on IPv6 literals (`[::1]`), which
	// `net.isIP` won't parse — strip them before the IP-range check.
	const literal =
		host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	const kind = isIP(literal); // 4, 6, or 0 (not an IP literal)
	if (kind === 4 && isBlockedIpv4(literal)) {
		return `host '${host}' resolves to a private / loopback / metadata address`;
	}
	if (kind === 6 && isBlockedIpv6(literal)) {
		return `host '${host}' resolves to a private / loopback / link-local address`;
	}
	return null;
}

/* -------- DNS-resolution SSRF guard (resolve-and-validate) -------- */

/** A resolved address from a {@link HostResolver}. */
export interface ResolvedAddress {
	readonly address: string;
	readonly family: number;
}

/**
 * Resolve a hostname to its IP addresses. Mirrors `dns.lookup(host,
 * { all: true })` — the OS resolver `fetch` itself would use — so what we
 * validate is what the connection would target.
 */
export type HostResolver = (
	hostname: string,
) => Promise<readonly ResolvedAddress[]>;

const defaultHostResolver: HostResolver = (hostname) =>
	dnsLookup(hostname, { all: true });

// Test seam (mirrors `setEndpointEgressPolicy`): override the resolver the
// native:fetch SSRF pre-flight uses, so tests can exercise the
// domain-resolves-to-internal path without real DNS.
let nativeFetchHostResolver: HostResolver = defaultHostResolver;

export function setNativeFetchHostResolver(resolver: HostResolver): void {
	nativeFetchHostResolver = resolver;
}

export function resetNativeFetchHostResolver(): void {
	nativeFetchHostResolver = defaultHostResolver;
}

/**
 * Full pre-flight host check for a model-supplied URL: the synchronous
 * literal-IP / blocked-name checks in {@link ssrfRejectReason}, PLUS —
 * for DNS names — resolution and validation of every resolved address
 * against the same blocked ranges. Closes the "a domain that resolves to
 * 169.254.169.254 / 10.x / loopback slips past the literal check" SSRF
 * hole (e.g. an attacker-controlled host reached via prompt injection).
 * Fails closed: a host that won't resolve, resolves to nothing, or
 * resolves to ANY blocked address is refused.
 *
 * Residual: a sub-second DNS rebind between this resolution and the one
 * `fetch` performs is still possible; fully closing it needs connection
 * pinning to the validated IP. The narrowed window plus `safeFetch`'s
 * `redirect: "error"` bound that residual risk.
 */
export async function resolvedSsrfRejectReason(
	rawUrl: string,
	resolveHost: HostResolver,
): Promise<string | null> {
	const literalReason = ssrfRejectReason(rawUrl);
	if (literalReason) return literalReason;

	// ssrfRejectReason already accepted the URL, so this parse succeeds.
	const host = new URL(rawUrl).hostname.toLowerCase();
	const literal =
		host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	// A literal IP was already range-checked synchronously above.
	if (isIP(literal) !== 0) return null;

	let addresses: readonly ResolvedAddress[];
	try {
		addresses = await resolveHost(host);
	} catch {
		return `host '${host}' could not be resolved`;
	}
	if (addresses.length === 0) {
		return `host '${host}' did not resolve to any address`;
	}
	for (const { address, family } of addresses) {
		const blocked =
			family === 6 ? isBlockedIpv6(address) : isBlockedIpv4(address);
		if (blocked) {
			return `host '${host}' resolves to a private / loopback / metadata address (${address})`;
		}
	}
	return null;
}

/* ----------------------------- size cap I/O ----------------------------- */

class ResponseTooLargeError extends Error {
	constructor(public readonly limit: number) {
		super(`response exceeded the ${limit}-byte cap`);
		this.name = "ResponseTooLargeError";
	}
}

/**
 * Read a response body up to `maxBytes`, decoding as UTF-8. Stops and
 * throws {@link ResponseTooLargeError} the moment the cap is crossed —
 * the unread remainder of the stream is cancelled so we don't keep
 * paying for bytes we'll discard. Falls back to `text()` only when the
 * body isn't a readable stream (shouldn't happen with `fetch`).
 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
	const body = res.body;
	if (!body) return "";
	const reader = body.getReader();
	const decoder = new TextDecoder("utf-8");
	let received = 0;
	let out = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > maxBytes) {
				throw new ResponseTooLargeError(maxBytes);
			}
			out += decoder.decode(value, { stream: true });
		}
		out += decoder.decode();
		return out;
	} finally {
		// Release/cancel the stream so an early exit (cap hit) doesn't
		// leave the socket draining in the background.
		await reader.cancel().catch(() => {});
	}
}

/** content-type prefixes the fetch tool will read; everything else is refused. */
const ALLOWED_CONTENT_TYPES: readonly string[] = [
	"text/",
	"application/json",
	"application/xml",
	"application/xhtml+xml",
	"application/ld+json",
];

function isAllowedContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	const value = contentType.toLowerCase();
	return ALLOWED_CONTENT_TYPES.some((prefix) =>
		prefix.endsWith("/")
			? value.startsWith(prefix)
			: value.split(";")[0]?.trim() === prefix,
	);
}

/* ------------------------------ native:fetch ---------------------------- */

const fetchArgs = z
	.object({
		url: z.string().min(1),
		method: z.enum(["GET", "POST"]).optional(),
		// Free-form request headers. Hop-by-hop / host-spoofing headers
		// are dropped before the request goes out (see SAFE handling).
		headers: z.record(z.string(), z.string()).optional(),
		// POST body. Sent verbatim; pair with a `content-type` header.
		body: z.string().optional(),
	})
	.strict();

/** Headers a caller is never allowed to set on the outbound request. */
const FORBIDDEN_REQUEST_HEADERS = new Set([
	"host",
	"content-length",
	"connection",
	"transfer-encoding",
]);

function sanitizeHeaders(
	raw: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
	const out: Record<string, string> = {};
	if (!raw) return out;
	for (const [k, v] of Object.entries(raw)) {
		if (FORBIDDEN_REQUEST_HEADERS.has(k.toLowerCase())) continue;
		out[k] = v;
	}
	return out;
}

function buildFetchTool(cfg: FetchToolConfig): AgentTool {
	const definition: ToolDefinition = {
		name: NATIVE_FETCH_TOOL_ID,
		description:
			"Fetch a public web URL over HTTP(S) and return its body as text. Use for reading a documentation page, a JSON API, or any public resource the user references. GET by default; pass method:'POST' with a body for form/JSON posts. Only http/https public hosts are reachable — private, loopback, and internal addresses are refused. Large responses are truncated and non-text content types are rejected.",
		parameters: {
			type: "object",
			required: ["url"],
			properties: {
				url: {
					type: "string",
					description:
						"Absolute http(s) URL to fetch, e.g. 'https://example.com/api'.",
				},
				method: {
					type: "string",
					enum: ["GET", "POST"],
					description: "HTTP method. Defaults to GET.",
				},
				headers: {
					type: "object",
					additionalProperties: { type: "string" },
					description:
						"Optional request headers (e.g. an Accept or Authorization header).",
				},
				body: {
					type: "string",
					description:
						"Optional request body for POST. Set a matching content-type header.",
				},
			},
			additionalProperties: false,
		},
	};

	return {
		definition,
		async execute(rawArgs) {
			const parsed = fetchArgs.safeParse(rawArgs);
			if (!parsed.success) return formatZodError(parsed.error);
			const { url, body } = parsed.data;
			const method = parsed.data.method ?? "GET";

			const reject = await resolvedSsrfRejectReason(
				url,
				nativeFetchHostResolver,
			);
			if (reject) {
				return `Error: refusing to fetch '${url}' — ${reject}.`;
			}

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
			try {
				const res = await safeFetch(url, {
					method,
					headers: sanitizeHeaders(parsed.data.headers),
					...(method === "POST" && body !== undefined ? { body } : {}),
					signal: controller.signal,
				});

				const contentType = res.headers.get("content-type");
				if (!isAllowedContentType(contentType)) {
					return `Error: refusing response from '${url}' — content-type '${contentType ?? "unknown"}' is not in the allow-list (text/*, application/json, application/xml).`;
				}

				const text = await readCapped(res, cfg.maxResponseBytes);
				return JSON.stringify({
					url: res.url || url,
					status: res.status,
					contentType,
					body: text,
				});
			} catch (err) {
				if (controller.signal.aborted) {
					return `Error: request to '${url}' timed out after ${cfg.timeoutMs}ms.`;
				}
				if (err instanceof ResponseTooLargeError) {
					return `Error: response from '${url}' exceeded the ${cfg.maxResponseBytes}-byte cap and was discarded.`;
				}
				return `Error: fetch failed for '${url}' — ${messageOf(err)}.`;
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

/* --------------------------- web-search provider ------------------------ */

/** A single search hit surfaced back to the model. */
export interface WebSearchResult {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
}

/**
 * The pluggable web-search seam: one function. A provider takes a query
 * (+ a bounded result count and an abort signal) and returns hits, or
 * throws on transport/credential failure (the tool wraps the throw into
 * an `Error: …` string). Keeping it to a single function is deliberate —
 * the point of A3 is the seam + guardrails, not search breadth.
 */
export type WebSearchProvider = (
	query: string,
	opts: { readonly maxResults: number; readonly signal: AbortSignal },
) => Promise<readonly WebSearchResult[]>;

/**
 * Built-in provider backed by Tavily's search API — a generic search
 * endpoint with a single bearer key, which keeps the example minimal.
 * Outbound goes through `safeFetch` like every other operator-driven
 * request. New providers slot in behind {@link WebSearchProvider}
 * without widening the tool's surface.
 */
function tavilyProvider(apiKey: string): WebSearchProvider {
	return async (query, { maxResults, signal }) => {
		const res = await safeFetch("https://api.tavily.com/search", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				api_key: apiKey,
				query,
				max_results: maxResults,
			}),
			signal,
		});
		if (!res.ok) {
			throw new Error(`search provider returned HTTP ${res.status}`);
		}
		const json = (await res.json()) as {
			results?: { title?: string; url?: string; content?: string }[];
		};
		const results = Array.isArray(json.results) ? json.results : [];
		return results.slice(0, maxResults).map((r) => ({
			title: typeof r.title === "string" ? r.title : "",
			url: typeof r.url === "string" ? r.url : "",
			snippet: typeof r.content === "string" ? r.content : "",
		}));
	};
}

/** Map a configured provider name to its factory. The seam for adding more. */
function resolveProvider(
	cfg: WebSearchToolConfig,
	apiKey: string,
): WebSearchProvider | null {
	switch (cfg.provider) {
		case "tavily":
			return tavilyProvider(apiKey);
		default:
			return null;
	}
}

const webSearchArgs = z
	.object({
		query: z.string().min(1),
		limit: z.number().int().positive().optional(),
	})
	.strict();

function buildWebSearchTool(
	cfg: WebSearchToolConfig,
	provider: WebSearchProvider,
): AgentTool {
	const definition: ToolDefinition = {
		name: NATIVE_WEB_SEARCH_TOOL_ID,
		description:
			"Search the public web and return the top matching results (title, URL, snippet). Use when the user asks about something outside the workspace's knowledge bases — current events, external docs, anything not ingested. Follow up with native:fetch to read a specific result in full.",
		parameters: {
			type: "object",
			required: ["query"],
			properties: {
				query: {
					type: "string",
					description: "Natural-language search query.",
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: cfg.maxResults,
					description: `Max results to return (default and hard cap ${cfg.maxResults}).`,
				},
			},
			additionalProperties: false,
		},
	};

	return {
		definition,
		async execute(rawArgs) {
			const parsed = webSearchArgs.safeParse(rawArgs);
			if (!parsed.success) return formatZodError(parsed.error);
			const limit = Math.min(
				parsed.data.limit ?? cfg.maxResults,
				cfg.maxResults,
			);

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
			try {
				const results = await provider(parsed.data.query, {
					maxResults: limit,
					signal: controller.signal,
				});
				if (results.length === 0) {
					return "No web results found for that query.";
				}
				return JSON.stringify({ results: results.slice(0, limit) });
			} catch (err) {
				if (controller.signal.aborted) {
					return `Error: web search timed out after ${cfg.timeoutMs}ms.`;
				}
				return `Error: web search failed — ${messageOf(err)}.`;
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

/* ------------------------------- provider ------------------------------- */

export async function nativeTools(
	ctx: ToolProviderContext,
): Promise<readonly AgentTool[]> {
	const toolsCfg = ctx.chatConfig?.tools;
	if (!toolsCfg) return [];

	const tools: AgentTool[] = [];

	if (toolsCfg.fetch.enabled) {
		tools.push(buildFetchTool(toolsCfg.fetch));
	}

	const ws = toolsCfg.webSearch;
	// Off unless explicitly enabled AND fully configured (provider + key).
	if (ws.enabled && ws.provider && ws.apiKeyRef) {
		try {
			const apiKey = await ctx.secrets.resolve(ws.apiKeyRef);
			const provider = resolveProvider(ws, apiKey);
			if (provider) {
				tools.push(buildWebSearchTool(ws, provider));
			} else {
				ctx.logger?.warn?.(
					{ provider: ws.provider },
					"web_search configured with an unknown provider; tool not registered",
				);
			}
		} catch (err) {
			// A bad/missing key ref shouldn't crash toolset resolution — the
			// tool is simply left off, mirroring the unconfigured case.
			ctx.logger?.warn?.(
				{ err, workspaceId: ctx.workspaceId },
				"web_search api key could not be resolved; tool not registered",
			);
		}
	}

	return tools;
}

/* -------------------------------- helpers ------------------------------- */

function messageOf(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

function formatZodError(err: z.ZodError): string {
	const issues = err.issues
		.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
		.join("; ");
	return `Error: invalid arguments — ${issues}.`;
}
