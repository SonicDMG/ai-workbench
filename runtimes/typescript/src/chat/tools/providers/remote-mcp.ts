/**
 * External MCP tool provider (0.4.0 A2).
 *
 * Reads the workspace's registered MCP servers
 * (`wb_config_mcp_servers_by_workspace`), connects to each **enabled**
 * server over Streamable HTTP, lists its tools, and adapts every tool
 * into an {@link AgentTool} named `mcp:{mcpServerId}:{toolName}`. The
 * adapted tool's `execute` opens a fresh short-lived session, calls the
 * remote tool, and returns its text content.
 *
 * ## Resilience
 *
 * A server that is unreachable, mis-configured, or whose credential
 * fails to resolve logs a warning and contributes **no** tools — it never
 * fails the whole turn. At execution time the same rule applies: any
 * connect/call error is returned as an `Error: …` string (never thrown),
 * so the model can read it and recover on the next iteration.
 *
 * ## Allow-list
 *
 * When a server row carries a non-null `allowedTools`, only the named
 * remote tools are exposed (empty list = none). `null` exposes every tool
 * the server advertises. This is in addition to the per-agent `toolIds`
 * allow-list applied by `resolveAgentToolset` — both must permit a tool
 * for it to reach the model.
 *
 * The server connection is opened per-call rather than held across the
 * turn because {@link AgentTool} is stateless (mirrors the built-in tools,
 * which each hit the store fresh) and there is no per-turn teardown hook.
 */

import type { McpServerRecord } from "../../../control-plane/types.js";
import type { SecretResolver } from "../../../secrets/provider.js";
import {
	connectMcpClient,
	type RemoteMcpSession,
	type RemoteMcpTool,
} from "../mcp-client.js";
import {
	DEFAULT_MCP_DISCOVERY_TTL_MS,
	discoveryCacheKey,
	getCachedDiscovery,
	setCachedDiscovery,
} from "../mcp-discovery-cache.js";
import type { AgentTool, ToolProviderContext } from "../registry.js";

/**
 * The MCP-client dependency the provider needs. Production passes
 * {@link connectMcpClient}; tests inject a factory that connects over an
 * `InMemoryTransport`. Kept as a narrow seam so the registry's call site
 * (`remoteMcpTools(ctx)`) stays unchanged.
 */
export interface RemoteMcpDeps {
	connect: typeof connectMcpClient;
}

const defaultDeps: RemoteMcpDeps = { connect: connectMcpClient };

/** Namespaced agent-tool name for a remote MCP tool. */
export function mcpToolName(mcpServerId: string, toolName: string): string {
	return `mcp:${mcpServerId}:${toolName}`;
}

/**
 * Build the remote-MCP agent tools for a workspace. Composed into the
 * candidate pool by `resolveAgentToolset`; only ever included for an
 * agent that names a `mcp:{serverId}:{tool}` id in its `toolIds`.
 */
export async function remoteMcpTools(
	ctx: ToolProviderContext,
): Promise<readonly AgentTool[]> {
	return remoteMcpToolsWith(ctx, defaultDeps);
}

/** Injectable variant for tests (swap in an in-memory transport). */
export async function remoteMcpToolsWith(
	ctx: ToolProviderContext,
	deps: RemoteMcpDeps,
): Promise<readonly AgentTool[]> {
	const servers = await ctx.store.listMcpServers(ctx.workspaceId);
	const enabled = servers.filter((s) => s.enabled);

	// One discovery connection per server, in parallel. A failure for one
	// server is isolated — it contributes no tools but never sinks the
	// others or the turn.
	const perServer = await Promise.all(
		enabled.map((server) => discoverServerTools(server, ctx, deps)),
	);
	return perServer.flat();
}

async function discoverServerTools(
	server: McpServerRecord,
	ctx: ToolProviderContext,
	deps: RemoteMcpDeps,
): Promise<readonly AgentTool[]> {
	const rawTools = await discoverRawTools(server, ctx, deps);
	if (rawTools === null) return []; // discovery failed — never cached
	// Allow-list + adaptation happen fresh on every call (cheap, in-memory)
	// so an `allowedTools`-only edit takes effect immediately and each
	// adapted tool closes over the CURRENT request's `ctx.secrets`.
	const allowed = filterByAllowList(rawTools, server.allowedTools);
	return allowed.map((tool) =>
		adaptRemoteTool(server, tool, ctx.secrets, deps),
	);
}

/**
 * Connect + `tools/list` for one server, memoized in the
 * {@link mcp-discovery-cache} for `chat.tools.mcp.discoveryTtlMs`. Returns
 * the raw {@link RemoteMcpTool} descriptors, or `null` on a discovery
 * failure (which is logged and **never cached** — the next turn retries).
 */
async function discoverRawTools(
	server: McpServerRecord,
	ctx: ToolProviderContext,
	deps: RemoteMcpDeps,
): Promise<readonly RemoteMcpTool[] | null> {
	const ttlMs =
		ctx.chatConfig?.tools?.mcp?.discoveryTtlMs ?? DEFAULT_MCP_DISCOVERY_TTL_MS;
	const key = discoveryCacheKey(
		ctx.workspaceId,
		server.mcpServerId,
		server.url,
		server.credentialRef,
	);
	if (ttlMs > 0) {
		const cached = getCachedDiscovery(key, Date.now());
		if (cached !== null) return cached;
	}
	let session: RemoteMcpSession | null = null;
	try {
		session = await deps.connect({
			url: server.url,
			credentialRef: server.credentialRef,
			secrets: ctx.secrets,
		});
		const remoteTools = await session.listTools();
		if (ttlMs > 0) setCachedDiscovery(key, remoteTools, Date.now() + ttlMs);
		return remoteTools;
	} catch (err) {
		ctx.logger?.warn?.(
			{
				err,
				workspaceId: ctx.workspaceId,
				mcpServerId: server.mcpServerId,
				label: server.label,
			},
			"remote MCP server unreachable during tool discovery; contributing no tools",
		);
		return null;
	} finally {
		if (session) {
			await session.close().catch(() => {
				// Best-effort close — a failed teardown must not surface.
			});
		}
	}
}

function filterByAllowList<T extends { readonly name: string }>(
	tools: readonly T[],
	allowedTools: readonly string[] | null,
): readonly T[] {
	if (allowedTools === null) return tools;
	const allow = new Set(allowedTools);
	return tools.filter((t) => allow.has(t.name));
}

/**
 * Wrap one discovered remote tool as an {@link AgentTool}. The
 * model-facing definition carries the namespaced name + the server's
 * advertised JSON Schema; `execute` reconnects, calls the remote tool,
 * and returns its text (Error string on any failure).
 */
function adaptRemoteTool(
	server: McpServerRecord,
	tool: RemoteMcpTool,
	secrets: SecretResolver,
	deps: RemoteMcpDeps,
): AgentTool {
	const name = mcpToolName(server.mcpServerId, tool.name);
	const description =
		tool.description ??
		`Tool '${tool.name}' from MCP server '${server.label}'.`;
	return {
		definition: {
			name,
			description,
			parameters: normalizeParameters(tool.inputSchema),
		},
		async execute(rawArgs): Promise<string> {
			const args =
				rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
					? (rawArgs as Record<string, unknown>)
					: {};
			let session: RemoteMcpSession | null = null;
			try {
				session = await deps.connect({
					url: server.url,
					credentialRef: server.credentialRef,
					secrets,
				});
				return await session.callTool(tool.name, args);
			} catch (err) {
				return `Error: MCP tool '${tool.name}' on server '${server.label}' failed — ${
					err instanceof Error ? err.message : String(err)
				}.`;
			} finally {
				if (session) {
					await session.close().catch(() => {});
				}
			}
		},
	};
}

/**
 * Coerce a remote tool's input schema into the object-schema shape the
 * agent tool definition expects. Falls back to a permissive empty object
 * schema when the server advertises something non-object.
 */
function normalizeParameters(
	inputSchema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	if (inputSchema.type === "object") return inputSchema;
	return { type: "object", properties: {}, additionalProperties: true };
}
