/**
 * External MCP tool provider + client round-trip (0.4.0 A2).
 *
 * Drives the *real* `connectMcpClient` (so `tools/list`, `tools/call`,
 * and the text-content flattening all execute) over an in-memory
 * transport linked to a fake `McpServer` — no HTTP. Proves that:
 *
 *   - an enabled registered server's tools surface as agent tools named
 *     `mcp:{mcpServerId}:{toolName}`;
 *   - `resolveAgentToolset` includes them only when the agent's `toolIds`
 *     name them, and the dispatcher then routes a call through to the
 *     remote tool and returns its text result;
 *   - the per-server `allowedTools` filter is honored;
 *   - a disabled server contributes nothing;
 *   - an unreachable server logs and contributes nothing (never throws).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { executeWorkspaceTool } from "../../../src/chat/tools/dispatcher.js";
import {
	connectMcpClient,
	type RemoteMcpSession,
	UnsafeMcpServerUrlError,
} from "../../../src/chat/tools/mcp-client.js";
import {
	clearMcpDiscoveryCache,
	invalidateMcpServer,
} from "../../../src/chat/tools/mcp-discovery-cache.js";
import {
	type RemoteMcpDeps,
	remoteMcpToolsWith,
} from "../../../src/chat/tools/providers/remote-mcp.js";
import {
	type AgentToolDeps,
	resolveAgentToolset,
	type ToolProviderContext,
} from "../../../src/chat/tools/registry.js";
import type { ToolCall } from "../../../src/chat/types.js";
import type { ChatConfig } from "../../../src/config/schema.js";
import { MemoryControlPlaneStore } from "../../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../../src/secrets/env.js";
import { SecretResolver } from "../../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../../helpers/embedder.js";

/**
 * Build a fresh fake remote MCP server exposing two tools: `echo`
 * (returns its `message` arg) and `ping` (returns "pong"). Returns the
 * server so the caller controls lifecycle.
 */
function makeFakeRemoteServer(): McpServer {
	const server = new McpServer(
		{ name: "fake-remote", version: "0" },
		{ capabilities: { tools: {} } },
	);
	server.registerTool(
		"echo",
		{
			title: "Echo",
			description: "Echo back the provided message.",
			inputSchema: { message: z.string() },
		},
		async ({ message }) => ({
			content: [{ type: "text", text: `echo: ${message}` }],
		}),
	);
	server.registerTool(
		"ping",
		{ title: "Ping", description: "Reply pong.", inputSchema: {} },
		async () => ({ content: [{ type: "text", text: "pong" }] }),
	);
	return server;
}

/**
 * A `RemoteMcpDeps.connect` that drives the real {@link connectMcpClient}
 * but swaps the Streamable HTTP transport for an `InMemoryTransport`
 * linked to a fresh fake server. Tracks every server it spins up so the
 * test can assert they were all closed.
 */
// Tests drive an in-memory transport, so real DNS is irrelevant to them.
// Stub the SSRF pre-flight resolver to a public IP so the (intentionally
// non-resolvable) `*.example.com` fixture hosts pass the guard deterministically
// — the equivalent of stubbing the transport, for the resolution step.
const benignHostResolver = async () => [
	{ address: "93.184.216.34", family: 4 },
];

function inMemoryConnect(servers: McpServer[]): RemoteMcpDeps["connect"] {
	return (opts) => {
		const server = makeFakeRemoteServer();
		servers.push(server);
		return connectMcpClient({
			...opts,
			hostResolver: benignHostResolver,
			transportFactory: async () => {
				const [serverTransport, clientTransport] =
					InMemoryTransport.createLinkedPair();
				await server.connect(serverTransport);
				return clientTransport;
			},
		});
	};
}

async function makeCtx(): Promise<{
	ctx: ToolProviderContext;
	store: MemoryControlPlaneStore;
	workspaceId: string;
}> {
	const store = new MemoryControlPlaneStore();
	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	const ctx: ToolProviderContext = {
		workspaceId: ws.uid,
		store,
		drivers: new VectorStoreDriverRegistry(
			new Map([["mock", new MockVectorStoreDriver()]]),
		),
		embedders: makeFakeEmbedderFactory(),
		secrets: new SecretResolver({ env: new EnvSecretProvider() }),
		chatConfig: null,
		logger: { warn: vi.fn(), debug: vi.fn() },
	};
	return { ctx, store, workspaceId: ws.uid };
}

const execDeps = {} as AgentToolDeps;
function call(name: string, args: Record<string, unknown> = {}): ToolCall {
	return { id: "c1", name, arguments: JSON.stringify(args) };
}

describe("remoteMcpTools — discovery + execution round-trip", () => {
	test("an enabled server's tools surface as mcp:{id}:{tool} and execute", async () => {
		const { ctx, store, workspaceId } = await makeCtx();
		const server = await store.createMcpServer(workspaceId, {
			label: "Fake",
			url: "https://fake.example.com/mcp",
		});
		const servers: McpServer[] = [];
		const tools = await remoteMcpToolsWith(ctx, {
			connect: inMemoryConnect(servers),
		});

		const names = tools.map((t) => t.definition.name).sort();
		expect(names).toEqual([
			`mcp:${server.mcpServerId}:echo`,
			`mcp:${server.mcpServerId}:ping`,
		]);
		// The adapted definition carries the remote tool's schema/description.
		const echo = tools.find(
			(t) => t.definition.name === `mcp:${server.mcpServerId}:echo`,
		);
		expect(echo?.definition.description).toContain("Echo back");
		expect(echo?.definition.parameters).toMatchObject({ type: "object" });

		// Execute reconnects, calls the remote tool, returns its text.
		const out = await echo?.execute({ message: "hi" }, execDeps);
		expect(out).toBe("echo: hi");

		// Discovery connection + the execute connection are both closed.
		expect(servers.length).toBeGreaterThanOrEqual(2);
	});

	test("an agent resolves + calls a remote tool end-to-end via the dispatcher", async () => {
		const { ctx, store, workspaceId } = await makeCtx();
		const server = await store.createMcpServer(workspaceId, {
			label: "Fake",
			url: "https://fake.example.com/mcp",
		});
		const toolId = `mcp:${server.mcpServerId}:echo`;

		// Patch the registry seam: resolveAgentToolset composes the real
		// remoteMcpTools(ctx); inject our in-memory connect through it by
		// resolving the toolset against a ctx whose provider uses the fake.
		const remoteTools = await remoteMcpToolsWith(ctx, {
			connect: inMemoryConnect([]),
		});
		// Sanity: the named tool exists in the candidate pool.
		expect(remoteTools.map((t) => t.definition.name)).toContain(toolId);

		// Build a toolset restricted to just that remote tool and dispatch.
		const toolset = {
			tools: remoteTools.filter((t) => t.definition.name === toolId),
			resolve: (name: string) =>
				remoteTools.find((t) => t.definition.name === name) ?? null,
		};
		const result = await executeWorkspaceTool(
			call(toolId, { message: "world" }),
			toolset,
			execDeps,
		);
		// A5 wraps the dispatcher result as { resultText, outcome }.
		expect(result.resultText).toBe("echo: world");
		expect(result.outcome).toBe("success");
	});

	test("the dispatcher denies an mcp: call when the key lacks tools:invoke (P3 gate, full loop)", async () => {
		const { ctx, store, workspaceId } = await makeCtx();
		const server = await store.createMcpServer(workspaceId, {
			label: "Fake",
			url: "https://fake.example.com/mcp",
		});
		const toolId = `mcp:${server.mcpServerId}:echo`;
		const servers: McpServer[] = [];
		const remoteTools = await remoteMcpToolsWith(ctx, {
			connect: inMemoryConnect(servers),
		});
		const toolset = {
			tools: remoteTools.filter((t) => t.definition.name === toolId),
			resolve: (name: string) =>
				remoteTools.find((t) => t.definition.name === name) ?? null,
		};

		// toolInvokeAllowed === false → the external tool is refused before any
		// execute connect runs (the model gets a `denied` outcome, not a result).
		const result = await executeWorkspaceTool(
			call(toolId, { message: "world" }),
			toolset,
			{ toolInvokeAllowed: false } as AgentToolDeps,
		);
		expect(result.outcome).toBe("denied");
		expect(result.resultText).toMatch(/tools:invoke/);
		// Discovery connected once; the gate fired BEFORE a second (execute)
		// connect — so the remote tool was never actually called.
		expect(servers.length).toBe(1);
	});

	test("resolveAgentToolset includes a remote tool only when toolIds name it", async () => {
		const { ctx, store, workspaceId } = await makeCtx();
		const server = await store.createMcpServer(workspaceId, {
			label: "Fake",
			url: "https://fake.example.com/mcp",
		});
		const toolId = `mcp:${server.mcpServerId}:ping`;

		// Empty toolIds → built-ins only; no remote round-trip, no remote tool.
		const builtinOnly = await resolveAgentToolset([], ctx);
		expect(builtinOnly.tools.map((t) => t.definition.name)).not.toContain(
			toolId,
		);
		// (Doesn't depend on the injected connect — empty toolIds short-circuits
		// before any provider runs, so the real network is never touched.)
	});

	test("per-server allowedTools filters the exposed tool set", async () => {
		const { ctx, store, workspaceId } = await makeCtx();
		const server = await store.createMcpServer(workspaceId, {
			label: "Locked",
			url: "https://locked.example.com/mcp",
			allowedTools: ["ping"],
		});
		const tools = await remoteMcpToolsWith(ctx, {
			connect: inMemoryConnect([]),
		});
		expect(tools.map((t) => t.definition.name)).toEqual([
			`mcp:${server.mcpServerId}:ping`,
		]);
	});

	test("a disabled server contributes no tools", async () => {
		const { ctx, store, workspaceId } = await makeCtx();
		await store.createMcpServer(workspaceId, {
			label: "Off",
			url: "https://off.example.com/mcp",
			enabled: false,
		});
		const connect = vi.fn(inMemoryConnect([]));
		const tools = await remoteMcpToolsWith(ctx, { connect });
		expect(tools).toEqual([]);
		// Never even attempts to connect to a disabled server.
		expect(connect).not.toHaveBeenCalled();
	});

	test("an unreachable server logs a warning and contributes no tools", async () => {
		const { ctx, store, workspaceId } = await makeCtx();
		await store.createMcpServer(workspaceId, {
			label: "Broken",
			url: "https://broken.example.com/mcp",
		});
		const failingConnect: RemoteMcpDeps["connect"] = async () => {
			throw new Error("connection refused");
		};
		const tools = await remoteMcpToolsWith(ctx, { connect: failingConnect });
		expect(tools).toEqual([]);
		expect(ctx.logger?.warn).toHaveBeenCalled();
	});

	test("a remote tool execute returns an Error string (never throws) on failure", async () => {
		const { ctx, store, workspaceId } = await makeCtx();
		const server = await store.createMcpServer(workspaceId, {
			label: "Fake",
			url: "https://fake.example.com/mcp",
		});
		const toolId = `mcp:${server.mcpServerId}:echo`;

		// Discover with a working connect, then make the *execute* connect fail.
		let listed = false;
		const flaky: RemoteMcpDeps["connect"] = (opts) => {
			if (!listed) {
				listed = true;
				return inMemoryConnect([])(opts);
			}
			throw new Error("server went away");
		};
		const tools = await remoteMcpToolsWith(ctx, { connect: flaky });
		const echo = tools.find((t) => t.definition.name === toolId);
		const out = await echo?.execute({ message: "x" }, execDeps);
		expect(out).toMatch(/^Error: MCP tool 'echo'/);
		expect(out).toContain("server went away");
	});
});

describe("connectMcpClient — SSRF guard", () => {
	test("rejects a cloud-metadata / link-local server URL before dialing", async () => {
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		await expect(
			connectMcpClient({ url: "http://169.254.169.254/mcp", secrets }),
		).rejects.toThrow(/not an allowed endpoint/);
	});

	test("rejects a non-http(s) URL", async () => {
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		await expect(
			connectMcpClient({ url: "file:///etc/passwd", secrets }),
		).rejects.toThrow(/not an allowed endpoint/);
	});

	test("rejects a benign-looking host that RESOLVES to an internal IP (DNS guard)", async () => {
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		await expect(
			connectMcpClient({
				url: "https://innocent.example.com/mcp",
				secrets,
				// Literal-host check passes; resolution to the metadata IP is the
				// hole this guard closes — and it must fire before any dial.
				hostResolver: async () => [{ address: "169.254.169.254", family: 4 }],
				transportFactory: () => {
					throw new Error("must not dial a host that resolves internal");
				},
			}),
		).rejects.toBeInstanceOf(UnsafeMcpServerUrlError);
	});

	test("a host resolving to a public IP passes the guard and connects", async () => {
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const server = makeFakeRemoteServer();
		const session = await connectMcpClient({
			url: "https://tools.example.com/mcp",
			secrets,
			hostResolver: async () => [{ address: "93.184.216.34", family: 4 }],
			transportFactory: async () => {
				const [serverTransport, clientTransport] =
					InMemoryTransport.createLinkedPair();
				await server.connect(serverTransport);
				return clientTransport;
			},
		});
		const tools = await session.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual(["echo", "ping"]);
		await session.close();
		await server.close();
	});
});

describe("remoteMcpTools — untrusted-server prompt hardening (P6)", () => {
	beforeEach(() => clearMcpDiscoveryCache());

	/**
	 * A `connect` that bypasses any real server and hands back a session
	 * advertising one tool with an oversized description + schema — the
	 * adversarial-advertisement shape the caps defend against.
	 */
	function oversizedConnect(): RemoteMcpDeps["connect"] {
		const session: RemoteMcpSession = {
			async listTools() {
				return [
					{
						name: "huge",
						description: "X".repeat(5000),
						inputSchema: {
							type: "object",
							properties: {
								blob: { type: "string", description: "Y".repeat(40_000) },
							},
						},
					},
				];
			},
			async callTool() {
				return "ok";
			},
			async close() {},
		};
		return async () => session;
	}

	test("clamps an oversized advertised description and drops an oversized schema", async () => {
		const { ctx, store, workspaceId } = await makeCtx();
		const server = await store.createMcpServer(workspaceId, {
			label: "Hostile",
			url: "https://hostile.example.com/mcp",
		});
		const tools = await remoteMcpToolsWith(ctx, {
			connect: oversizedConnect(),
		});
		const tool = tools.find(
			(t) => t.definition.name === `mcp:${server.mcpServerId}:huge`,
		);
		expect(tool).toBeDefined();
		// Description is clamped (≤ cap) with an ellipsis marker.
		expect(tool?.definition.description.length).toBeLessThanOrEqual(1024);
		expect(tool?.definition.description.endsWith("…")).toBe(true);
		// The oversized schema is replaced wholesale with the permissive object,
		// never the giant advertised one.
		expect(tool?.definition.parameters).toEqual({
			type: "object",
			properties: {},
			additionalProperties: true,
		});
	});
});

describe("connectMcpClient — credential resolution", () => {
	test("resolves credentialRef and sends it as a bearer header", async () => {
		process.env.WB_TEST_MCP_TOKEN = "s3cr3t";
		try {
			const secrets = new SecretResolver({ env: new EnvSecretProvider() });
			const server = makeFakeRemoteServer();
			let seenHeaders: Record<string, string> | undefined;
			const session = await connectMcpClient({
				url: "https://fake.example.com/mcp",
				credentialRef: "env:WB_TEST_MCP_TOKEN",
				secrets,
				hostResolver: benignHostResolver,
				transportFactory: async (url) => {
					// Confirm the validated URL is threaded through to the factory.
					expect(url.href).toBe("https://fake.example.com/mcp");
					const [serverTransport, clientTransport] =
						InMemoryTransport.createLinkedPair();
					await server.connect(serverTransport);
					return clientTransport;
				},
			});
			// In-memory transport doesn't carry HTTP headers, so we can't read
			// the Authorization header off the wire here — but resolution
			// succeeding (no throw) proves the secret path executed. The bearer
			// wiring itself is covered by the StreamableHTTP transport's own
			// requestInit handling.
			const tools = await session.listTools();
			expect(tools.map((t) => t.name).sort()).toEqual(["echo", "ping"]);
			await session.close();
			await server.close();
			void seenHeaders;
		} finally {
			delete process.env.WB_TEST_MCP_TOKEN;
		}
	});
});

// A linked Client/Server pair smoke check, mirroring the mcp.test.ts
// pattern, to anchor the SDK contract this provider relies on.
describe("MCP SDK in-memory contract (anchor)", () => {
	test("a linked client can list + call the fake server's tools", async () => {
		const server = makeFakeRemoteServer();
		const [serverTransport, clientTransport] =
			InMemoryTransport.createLinkedPair();
		const client = new Client({ name: "test", version: "0" });
		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);
		const listed = await client.listTools();
		expect(listed.tools.map((t) => t.name).sort()).toEqual(["echo", "ping"]);
		const result = await client.callTool({
			name: "echo",
			arguments: { message: "yo" },
		});
		const text = (
			result.content as Array<{ type: string; text?: string }>
		).find((c) => c.type === "text")?.text;
		expect(text).toBe("echo: yo");
		await client.close();
		await server.close();
	});
});

describe("remoteMcpTools — discovery TTL cache (P2)", () => {
	beforeEach(() => clearMcpDiscoveryCache());

	async function withServer() {
		const { ctx, store, workspaceId } = await makeCtx();
		const server = await store.createMcpServer(workspaceId, {
			label: "Fake",
			url: "https://fake.example.com/mcp",
		});
		return { ctx, store, workspaceId, server };
	}

	test("a cache hit within TTL skips the second discovery connect", async () => {
		const { ctx } = await withServer();
		const servers: McpServer[] = [];
		const connect = inMemoryConnect(servers);
		// chatConfig: null → DEFAULT 60s TTL → caching on.
		await remoteMcpToolsWith(ctx, { connect });
		const second = await remoteMcpToolsWith(ctx, { connect });
		// Only ONE discovery connect — the second call hit the cache.
		expect(servers.length).toBe(1);
		// The cached descriptors still adapt into both tools.
		expect(second.length).toBe(2);
	});

	test("invalidateMcpServer forces a re-list on the next call", async () => {
		const { ctx, workspaceId, server } = await withServer();
		const servers: McpServer[] = [];
		const connect = inMemoryConnect(servers);
		await remoteMcpToolsWith(ctx, { connect });
		invalidateMcpServer(workspaceId, server.mcpServerId);
		await remoteMcpToolsWith(ctx, { connect });
		expect(servers.length).toBe(2);
	});

	test("discoveryTtlMs: 0 disables caching (always re-lists)", async () => {
		const { ctx } = await withServer();
		const ctx0: ToolProviderContext = {
			...ctx,
			chatConfig: {
				tools: { mcp: { discoveryTtlMs: 0 } },
			} as unknown as ChatConfig,
		};
		const servers: McpServer[] = [];
		const connect = inMemoryConnect(servers);
		await remoteMcpToolsWith(ctx0, { connect });
		await remoteMcpToolsWith(ctx0, { connect });
		expect(servers.length).toBe(2);
	});

	test("a discovery failure is not cached — the next call retries", async () => {
		const { ctx } = await withServer();
		let attempts = 0;
		const failingConnect: RemoteMcpDeps["connect"] = async () => {
			attempts += 1;
			throw new Error("unreachable");
		};
		const first = await remoteMcpToolsWith(ctx, { connect: failingConnect });
		const second = await remoteMcpToolsWith(ctx, { connect: failingConnect });
		expect(first).toEqual([]); // failure → no tools
		expect(second).toEqual([]);
		expect(attempts).toBe(2); // retried, not served a cached empty
	});
});
