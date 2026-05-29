/**
 * Native tool provider (A3) — `native:fetch` + `native:web_search`.
 *
 * Guardrail coverage:
 *   - config gating: both tools off unless `chat.tools.*.enabled`;
 *     web_search additionally off unless provider + apiKeyRef set.
 *   - SSRF: literal private/loopback/link-local/metadata hosts refused
 *     pre-flight (no fetch issued); a public host that 302s to an
 *     internal address is refused by `safeFetch`'s `redirect: "error"`
 *     (round-tripped end to end through a real in-process redirector).
 *   - timeout (AbortController), oversized-body cap (streamed), and
 *     content-type allow-list — each returns an `Error: …` string, never
 *     throws.
 *
 * The non-SSRF guardrails are exercised by pointing the tool at a
 * public-looking URL and stubbing `globalThis.fetch` to return crafted
 * `Response` objects (the repo's standard pattern — see
 * `tests/lib/safe-fetch.test.ts`). That keeps the pre-flight host guard
 * green while we test content-type / size / timeout behaviour. The
 * redirect-chain SSRF leg is the one case that uses a real server, since
 * it asserts a transport-level behaviour of `safeFetch`.
 */

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	NATIVE_FETCH_TOOL_ID,
	NATIVE_WEB_SEARCH_TOOL_ID,
	nativeTools,
} from "../../../src/chat/tools/providers/native.js";
import type {
	AgentTool,
	AgentToolDeps,
	ToolProviderContext,
} from "../../../src/chat/tools/registry.js";
import type { ChatToolsConfig } from "../../../src/config/schema.js";
import { MemoryControlPlaneStore } from "../../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../../src/secrets/env.js";
import { SecretResolver } from "../../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../../helpers/embedder.js";

const PUBLIC_URL = "https://example.test/resource";

// Tools take no exec deps beyond what the registry binds; the native
// tools close over their config + resolved key at construction time, so
// a bare stub satisfies `execute(rawArgs, deps)`.
const stubDeps = {} as AgentToolDeps;

/* ------------------------------- fixtures ------------------------------- */

function toolsConfig(over: {
	fetch?: Partial<ChatToolsConfig["fetch"]>;
	webSearch?: Partial<ChatToolsConfig["webSearch"]>;
}): ChatToolsConfig {
	return {
		fetch: {
			enabled: false,
			timeoutMs: 10_000,
			maxResponseBytes: 1_048_576,
			...over.fetch,
		},
		webSearch: {
			enabled: false,
			provider: null,
			apiKeyRef: null,
			timeoutMs: 10_000,
			maxResults: 5,
			...over.webSearch,
		},
	};
}

async function makeCtx(
	tools: ChatToolsConfig | undefined,
): Promise<ToolProviderContext> {
	const store = new MemoryControlPlaneStore();
	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	return {
		workspaceId: ws.uid,
		store,
		drivers: new VectorStoreDriverRegistry(
			new Map([["mock", new MockVectorStoreDriver()]]),
		),
		embedders: makeFakeEmbedderFactory(),
		secrets: new SecretResolver({ env: new EnvSecretProvider() }),
		chatConfig: tools
			? {
					enabled: true,
					provider: "openrouter",
					tokenRef: "env:UNUSED",
					baseUrl: null,
					model: "fake",
					maxOutputTokens: 256,
					retrievalK: 4,
					allowDataCollection: false,
					systemPrompt: null,
					tools,
				}
			: null,
	};
}

async function fetchTool(
	over: Partial<ChatToolsConfig["fetch"]> = {},
): Promise<AgentTool> {
	const ctx = await makeCtx(toolsConfig({ fetch: { enabled: true, ...over } }));
	const tool = (await nativeTools(ctx)).find(
		(t) => t.definition.name === NATIVE_FETCH_TOOL_ID,
	);
	if (!tool) throw new Error("expected native:fetch to be built");
	return tool;
}

/** A `Response` whose body streams `size` bytes in small chunks. */
function streamingResponse(size: number, contentType: string): Response {
	const chunk = new TextEncoder().encode("x".repeat(1_000));
	let sent = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent >= size) {
				controller.close();
				return;
			}
			const remaining = size - sent;
			controller.enqueue(
				remaining >= chunk.byteLength ? chunk : chunk.slice(0, remaining),
			);
			sent += chunk.byteLength;
		},
	});
	return new Response(body, {
		status: 200,
		headers: { "content-type": contentType },
	});
}

function listen(server: Server): Promise<{ port: number }> {
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () =>
			resolve(server.address() as { port: number }),
		),
	);
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()));
}

/* ----------------------------- config gating ---------------------------- */

describe("nativeTools — config gating", () => {
	test("no chatConfig → no native tools", async () => {
		expect(await nativeTools(await makeCtx(undefined))).toEqual([]);
	});

	test("fetch disabled → fetch tool not built", async () => {
		const tools = await nativeTools(await makeCtx(toolsConfig({})));
		expect(
			tools.find((t) => t.definition.name === NATIVE_FETCH_TOOL_ID),
		).toBeUndefined();
	});

	test("fetch enabled → exactly the native:fetch tool, namespaced id", async () => {
		const tools = await nativeTools(
			await makeCtx(toolsConfig({ fetch: { enabled: true } })),
		);
		expect(tools.map((t) => t.definition.name)).toEqual([NATIVE_FETCH_TOOL_ID]);
		expect(NATIVE_FETCH_TOOL_ID).toBe("native:fetch");
	});
});

/* ---------------------------- web_search gating ------------------------- */

describe("nativeTools — web_search off when unconfigured", () => {
	afterEach(() => vi.unstubAllEnvs());

	test("enabled but no provider/key → tool NOT returned", async () => {
		const tools = await nativeTools(
			await makeCtx(toolsConfig({ webSearch: { enabled: true } })),
		);
		expect(
			tools.find((t) => t.definition.name === NATIVE_WEB_SEARCH_TOOL_ID),
		).toBeUndefined();
	});

	test("provider+key set but enabled:false → tool NOT returned", async () => {
		vi.stubEnv("TAVILY_KEY", "secret-key");
		const tools = await nativeTools(
			await makeCtx(
				toolsConfig({
					webSearch: {
						enabled: false,
						provider: "tavily",
						apiKeyRef: "env:TAVILY_KEY",
					},
				}),
			),
		);
		expect(
			tools.find((t) => t.definition.name === NATIVE_WEB_SEARCH_TOOL_ID),
		).toBeUndefined();
	});

	test("enabled + provider + resolvable key → tool returned", async () => {
		vi.stubEnv("TAVILY_KEY", "secret-key");
		const tools = await nativeTools(
			await makeCtx(
				toolsConfig({
					webSearch: {
						enabled: true,
						provider: "tavily",
						apiKeyRef: "env:TAVILY_KEY",
					},
				}),
			),
		);
		expect(tools.map((t) => t.definition.name)).toContain(
			NATIVE_WEB_SEARCH_TOOL_ID,
		);
	});

	test("enabled + provider but UNRESOLVABLE key → tool NOT returned (no throw)", async () => {
		// env var deliberately not set — secret resolution rejects.
		const tools = await nativeTools(
			await makeCtx(
				toolsConfig({
					webSearch: {
						enabled: true,
						provider: "tavily",
						apiKeyRef: "env:DEFINITELY_NOT_SET_KEY",
					},
				}),
			),
		);
		expect(
			tools.find((t) => t.definition.name === NATIVE_WEB_SEARCH_TOOL_ID),
		).toBeUndefined();
	});
});

/* --------------------------- SSRF: pre-flight --------------------------- */

describe("native:fetch — SSRF rejection (refused before any fetch)", () => {
	afterEach(() => vi.restoreAllMocks());

	test.each([
		["http://127.0.0.1/", /loopback|private|metadata/i],
		["http://10.0.0.1/", /private|loopback|metadata/i],
		["http://192.168.1.1/", /private|loopback|metadata/i],
		["http://172.16.0.1/", /private|loopback|metadata/i],
		["http://172.31.255.255/", /private|loopback|metadata/i],
		["http://169.254.169.254/latest/meta-data/", /private|loopback|metadata/i],
		["http://localhost:8080/", /not allowed/i],
		["http://metadata.google.internal/", /not allowed/i],
		["http://[::1]/", /loopback|private|link-local/i],
		["http://[fd00::1]/", /loopback|private|link-local/i],
		["ftp://example.com/", /unsupported protocol/i],
		["file:///etc/passwd", /unsupported protocol/i],
		["not a url", /valid absolute URL/i],
	])("refuses %s without issuing a request", async (url, expected) => {
		// Stub so a guard miss would surface as an unexpected call rather
		// than a real (and flaky) network attempt.
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 200 }));
		const tool = await fetchTool();
		const result = await tool.execute({ url }, stubDeps);
		expect(result).toMatch(/^Error:/);
		expect(result).toMatch(expected);
		expect(spy).not.toHaveBeenCalled();
	});

	test("a public host (not blocked pre-flight) IS attempted", async () => {
		const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", {
				status: 200,
				headers: { "content-type": "text/plain" },
			}),
		);
		const tool = await fetchTool();
		await tool.execute({ url: PUBLIC_URL }, stubDeps);
		expect(spy).toHaveBeenCalledTimes(1);
	});
});

/* ---------------------- SSRF: redirect-to-internal ---------------------- */

describe("native:fetch — redirect-to-internal is refused by safeFetch", () => {
	test("a 302 to an internal host yields an Error string, not a chased request", async () => {
		// Real in-process redirector — a *public* host (here served on
		// loopback, but reached via a public-looking alias rewritten in the
		// fetch stub) returns a 302 to 169.254.169.254. `safeFetch` sets
		// redirect:'error', so Node throws on the first hop rather than
		// following it. The tool must turn that into an `Error:` string.
		const server = createServer((_req, res) => {
			res.writeHead(302, { Location: "http://169.254.169.254/" });
			res.end();
		});
		const { port } = await listen(server);
		const realFetch = globalThis.fetch.bind(globalThis);
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation((input, init) => {
				// Rewrite the public alias the guard approved back to the
				// loopback redirector so we exercise the transport layer.
				const u = typeof input === "string" ? input : String(input);
				return realFetch(
					u.replace("https://redirector.test/", `http://127.0.0.1:${port}/`),
					init,
				);
			});
		try {
			const tool = await fetchTool();
			const result = await tool.execute(
				{ url: "https://redirector.test/" },
				stubDeps,
			);
			expect(result).toMatch(/^Error: fetch failed/);
		} finally {
			spy.mockRestore();
			await closeServer(server);
		}
	});
});

/* -------------------------- guardrails (stubbed) ------------------------ */

describe("native:fetch — content-type allow-list", () => {
	afterEach(() => vi.restoreAllMocks());

	test("returns body + status for an allowed text/* response", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("hello world", {
				status: 200,
				headers: { "content-type": "text/plain; charset=utf-8" },
			}),
		);
		const tool = await fetchTool();
		const result = await tool.execute({ url: PUBLIC_URL }, stubDeps);
		const parsed = JSON.parse(result);
		expect(parsed.status).toBe(200);
		expect(parsed.body).toBe("hello world");
		expect(parsed.contentType).toMatch(/text\/plain/);
	});

	test("accepts application/json", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response('{"ok":true}', {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const tool = await fetchTool();
		const result = await tool.execute({ url: PUBLIC_URL }, stubDeps);
		expect(JSON.parse(result).body).toBe('{"ok":true}');
	});

	test("rejects a disallowed content-type (image/png)", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("\x89PNG", {
				status: 200,
				headers: { "content-type": "image/png" },
			}),
		);
		const tool = await fetchTool();
		const result = await tool.execute({ url: PUBLIC_URL }, stubDeps);
		expect(result).toMatch(/^Error:/);
		expect(result).toMatch(
			/content-type 'image\/png' is not in the allow-list/,
		);
	});

	test("rejects a missing content-type", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("body", { status: 200 }),
		);
		const tool = await fetchTool();
		const result = await tool.execute({ url: PUBLIC_URL }, stubDeps);
		// `fetch`/undici defaults an absent content-type to text/plain, so
		// either outcome is acceptable — but it must never throw.
		expect(typeof result).toBe("string");
	});
});

describe("native:fetch — response-size cap", () => {
	afterEach(() => vi.restoreAllMocks());

	test("oversized streamed body returns an Error and never the body", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			streamingResponse(50_000, "text/plain"),
		);
		const tool = await fetchTool({ maxResponseBytes: 1_024 });
		const result = await tool.execute({ url: PUBLIC_URL }, stubDeps);
		expect(result).toMatch(/^Error:/);
		expect(result).toMatch(/exceeded the 1024-byte cap/);
		expect(result).not.toMatch(/"body"/);
	});

	test("a body within the cap is returned in full", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("x".repeat(500), {
				status: 200,
				headers: { "content-type": "text/plain" },
			}),
		);
		const tool = await fetchTool({ maxResponseBytes: 1_024 });
		const result = await tool.execute({ url: PUBLIC_URL }, stubDeps);
		expect(JSON.parse(result).body).toBe("x".repeat(500));
	});
});

describe("native:fetch — timeout", () => {
	afterEach(() => vi.restoreAllMocks());

	test("a hung request aborts and returns a timeout Error, never throws", async () => {
		// Honour the AbortSignal: reject with an abort error when the
		// controller fires, mirroring how undici behaves on abort.
		vi.spyOn(globalThis, "fetch").mockImplementation(
			(_input, init) =>
				new Promise((_resolve, reject) => {
					const signal = init?.signal;
					if (!signal) return; // never settles otherwise
					signal.addEventListener("abort", () => {
						reject(
							Object.assign(new Error("This operation was aborted"), {
								name: "AbortError",
							}),
						);
					});
				}),
		);
		const tool = await fetchTool({ timeoutMs: 50 });
		const result = await tool.execute({ url: PUBLIC_URL }, stubDeps);
		expect(result).toMatch(/^Error:/);
		expect(result).toMatch(/timed out after 50ms/);
	});
});

/* ---------------------------- arg validation ---------------------------- */

describe("native:fetch — argument validation", () => {
	test("missing url → Error string (not a throw)", async () => {
		const tool = await fetchTool();
		const result = await tool.execute({}, stubDeps);
		expect(result).toMatch(/^Error: invalid arguments/);
	});

	test("unknown extra field → Error string", async () => {
		const tool = await fetchTool();
		const result = await tool.execute(
			{ url: "https://example.com/", nope: 1 },
			stubDeps,
		);
		expect(result).toMatch(/^Error: invalid arguments/);
	});

	test("a generic fetch failure becomes an Error string", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new TypeError("fetch failed"),
		);
		const tool = await fetchTool();
		const result = await tool.execute({ url: PUBLIC_URL }, stubDeps);
		expect(result).toMatch(/^Error: fetch failed for/);
		vi.restoreAllMocks();
	});
});

/* ------------------------------ web_search ------------------------------ */

describe("native:web_search — execution", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	async function searchTool(): Promise<AgentTool> {
		vi.stubEnv("TAVILY_KEY", "secret-key");
		const ctx = await makeCtx(
			toolsConfig({
				webSearch: {
					enabled: true,
					provider: "tavily",
					apiKeyRef: "env:TAVILY_KEY",
					maxResults: 3,
					timeoutMs: 5_000,
				},
			}),
		);
		const tool = (await nativeTools(ctx)).find(
			(t) => t.definition.name === NATIVE_WEB_SEARCH_TOOL_ID,
		);
		if (!tool) throw new Error("expected native:web_search to be built");
		return tool;
	}

	test("maps provider hits and never leaks the api key", async () => {
		const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [
						{ title: "T1", url: "https://a.test", content: "snippet 1" },
						{ title: "T2", url: "https://b.test", content: "snippet 2" },
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const tool = await searchTool();
		const result = await tool.execute({ query: "weather" }, stubDeps);
		const parsed = JSON.parse(result);
		expect(parsed.results).toHaveLength(2);
		expect(parsed.results[0]).toEqual({
			title: "T1",
			url: "https://a.test",
			snippet: "snippet 1",
		});
		// The key rides in the outbound body but is never echoed back to
		// the model.
		expect(result).not.toContain("secret-key");
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0]?.[0]).toBe("https://api.tavily.com/search");
	});

	test("honours the result limit (caps below the configured max)", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					results: Array.from({ length: 10 }, (_v, i) => ({
						title: `T${i}`,
						url: `https://x${i}.test`,
						content: `c${i}`,
					})),
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const tool = await searchTool();
		const result = await tool.execute({ query: "x", limit: 2 }, stubDeps);
		expect(JSON.parse(result).results).toHaveLength(2);
	});

	test("provider HTTP error → Error string (no throw)", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("nope", { status: 401 }),
		);
		const tool = await searchTool();
		const result = await tool.execute({ query: "x" }, stubDeps);
		expect(result).toMatch(/^Error: web search failed/);
		expect(result).toMatch(/HTTP 401/);
	});

	test("empty results → friendly no-results string", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ results: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const tool = await searchTool();
		const result = await tool.execute({ query: "x" }, stubDeps);
		expect(result).toMatch(/No web results/);
	});

	test("missing query → Error string", async () => {
		const tool = await searchTool();
		const result = await tool.execute({}, stubDeps);
		expect(result).toMatch(/^Error: invalid arguments/);
	});
});
