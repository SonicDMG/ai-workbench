/**
 * `/api/v1/workspaces/{workspaceId}/connect/*` — the workspace
 * **Connect** surface. Renders per-framework recipes ("how do I plug
 * this workspace into LangGraph / CrewAI / Google ADK / Microsoft
 * Agent Framework / IBM watsonx Agent Builder?") so the customer can
 * copy-paste a working snippet without leaving the product.
 *
 * Design notes:
 *   - **Pure read.** No control-plane mutations; safe to call from a
 *     public landing-page demo. Auth is the same workspace-scoped
 *     middleware as every other `/api/v1/*` route.
 *   - **No secrets in the response.** The rendered code references
 *     the API key by env-var name (`WORKBENCH_API_KEY` by default,
 *     overridable via `?apiKeyEnvVar=`) so a screenshare of the
 *     Connect tab never leaks a token.
 *   - **Stateless / cache-friendly.** The body is a pure function of
 *     `(workspaceId, knowledgeBaseId, publicBaseUrl, apiKeyEnvVar,
 *     mcp.enabled)`; the route stamps a short `Cache-Control` so the
 *     UI can re-render without re-rendering server-side.
 *
 * See `docs/integrations/` for the same snippets rendered as static
 * documentation, kept in lockstep with this generator by the
 * conformance harness.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ChatService } from "../../chat/types.js";
import type { ChatConfig, McpConfig } from "../../config/schema.js";
import { buildAllSnippets } from "../../connect/snippets/index.js";
import {
	mcpUrl as buildMcpUrl,
	restBaseUrl as buildRestBaseUrl,
} from "../../connect/snippets/urls.js";
import type { SnippetContext } from "../../connect/types.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { ApiError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { mcpTrafficBuffer } from "../../lib/mcp-traffic-buffer.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { resolvePublicBaseUrl } from "../../lib/public-url.js";
import type { AppEnv } from "../../lib/types.js";
import { buildMcpServer } from "../../mcp/server.js";
import {
	ConnectSnippetsQuerySchema,
	ConnectSnippetsResponseSchema,
	ConnectTrafficQuerySchema,
	ConnectTrafficResponseSchema,
	ConnectVerifyResponseSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import type { IngestService } from "../../services/ingest-service.js";

export interface ConnectRouteDeps {
	readonly store: ControlPlaneStore;
	readonly mcpConfig: McpConfig;
	/**
	 * The same deps `mcpRoutes` builds an MCP server from. Threaded
	 * through so the `verify` smoke test can spin up an in-process MCP
	 * server + client pair and exercise `tools/list` against the real
	 * registration code — no HTTP round-trip, no separate code path
	 * that could drift from production.
	 *
	 * All five are optional in the type so older test harnesses that
	 * only need the snippets route can still pass a stripped deps
	 * object; the verify route returns `mcpEnabled: false` whenever
	 * deps are insufficient.
	 */
	readonly drivers?: VectorStoreDriverRegistry;
	readonly embedders?: EmbedderFactory;
	readonly chatService?: ChatService | null;
	readonly chatConfig?: ChatConfig | null;
	readonly ingestService?: IngestService | null;
}

const DEFAULT_API_KEY_ENV_VAR = "WORKBENCH_API_KEY";

export function connectRoutes(deps: ConnectRouteDeps): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/connect/snippets",
			tags: ["connect"],
			summary: "Render per-framework integration recipes",
			description:
				"Returns a copy-pasteable snippet per supported agent framework (LangGraph, CrewAI, Google ADK, Microsoft Agent Framework, IBM watsonx Agent Builder, plus a raw curl smoke test). Pure read; no secrets are ever embedded in the rendered code — snippets read the API key from the env var named by `apiKeyEnvVar`.",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: ConnectSnippetsQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: ConnectSnippetsResponseSchema },
					},
					description:
						"Rendered snippets plus the resolved endpoint URLs for the workspace.",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const query = c.req.valid("query");

			const workspace = await deps.store.getWorkspace(workspaceId);
			if (!workspace) {
				throw new ApiError(
					"workspace_not_found",
					`workspace '${workspaceId}' not found`,
					404,
				);
			}

			const publicBaseUrl = resolvePublicBaseUrl(c.req.raw);
			const apiKeyEnvVar = query.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV_VAR;
			const knowledgeBaseId = query.knowledgeBaseId ?? null;
			const ctx: SnippetContext = {
				workspaceId,
				knowledgeBaseId,
				publicBaseUrl,
				mcpEnabled: deps.mcpConfig.enabled,
				apiKeyEnvVar,
			};

			const targets = buildAllSnippets(ctx);

			// Short private cache: the body is a pure function of inputs,
			// but the API-key state can change (rotations, revocations)
			// independently and the user does not need stale snippets in a
			// CDN. 60s is enough to make a fast tab-switch feel instant.
			c.header("Cache-Control", "private, max-age=60");

			return c.json(
				{
					workspaceId,
					knowledgeBaseId,
					publicBaseUrl,
					mcpUrl: buildMcpUrl(publicBaseUrl, workspaceId),
					restBaseUrl: buildRestBaseUrl(publicBaseUrl),
					mcpEnabled: deps.mcpConfig.enabled,
					apiKeyEnvVar,
					// Spread so the wire-type's `targets: ConnectSnippet[]`
					// gets a mutable array — `buildAllSnippets` returns a
					// `readonly` slice that Zod's inferred shape doesn't
					// accept.
					targets: [...targets],
				},
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/connect/verify",
			tags: ["connect"],
			summary: "Smoke-test the workspace's MCP endpoint",
			description:
				"Runs an internal JSON-RPC `tools/list` against the workspace's MCP server and reports what it finds. Drives the Connect tab's **Test** button — gives the user a one-click confirmation that the wire works before they paste a snippet anywhere. Always 200; failure modes are encoded in the envelope (`ok: false`, structured `error`) so the UI doesn't need to differentiate 500s from legitimate `mcp.enabled: false`.",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: ConnectVerifyResponseSchema },
					},
					description:
						"Verification outcome. Inspect `ok`, `mcpEnabled`, and `error` to render success / off / failed states.",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");

			const workspace = await deps.store.getWorkspace(workspaceId);
			if (!workspace) {
				throw new ApiError(
					"workspace_not_found",
					`workspace '${workspaceId}' not found`,
					404,
				);
			}

			const startedAt = Date.now();
			const elapsed = (): number => Date.now() - startedAt;

			// MCP is the only verify path today. If it's off (or the
			// caller skipped wiring the MCP deps into this plugin),
			// short-circuit with `ok: false` rather than 500ing — the
			// UI will render an amber warning either way.
			if (!deps.mcpConfig.enabled || !deps.drivers || !deps.embedders) {
				return c.json(
					{
						ok: false,
						mcpEnabled: deps.mcpConfig.enabled,
						toolCount: 0,
						tools: [],
						latencyMs: elapsed(),
						error: deps.mcpConfig.enabled
							? {
									code: "verify_not_wired",
									message:
										"verify route is missing MCP server deps; check the plugin registration",
								}
							: null,
					},
					200,
				);
			}

			// Drive `buildMcpServer` + an InMemoryTransport pair — same
			// pattern the unit tests use. We deliberately don't proxy
			// through the HTTP route here: that would re-run the full
			// auth middleware (which we already passed) and Streamable
			// HTTP transport (which would need a synthetic Request
			// constructed correctly). The in-memory path validates
			// what we care about — tool registration is wired and
			// `tools/list` returns the expected set — and runs in
			// O(1ms) instead of going around the local loopback.
			const server = buildMcpServer(workspaceId, {
				store: deps.store,
				drivers: deps.drivers,
				embedders: deps.embedders,
				chatService: deps.chatService ?? null,
				chatConfig: deps.chatConfig ?? null,
				exposeChat: deps.mcpConfig.exposeChat,
				ingestService: deps.ingestService ?? null,
			});
			const [serverTransport, clientTransport] =
				InMemoryTransport.createLinkedPair();
			const client = new Client({
				name: "ai-workbench:verify",
				version: "0",
			});

			try {
				await Promise.all([
					server.connect(serverTransport),
					client.connect(clientTransport),
				]);
				const { tools } = await client.listTools();
				const names = tools
					.map((t) => t.name)
					.sort((a, b) => a.localeCompare(b));
				return c.json(
					{
						ok: true,
						mcpEnabled: true,
						toolCount: names.length,
						tools: names,
						latencyMs: elapsed(),
						error: null,
					},
					200,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.warn({ workspaceId, err: message }, "connect.verify failed");
				return c.json(
					{
						ok: false,
						mcpEnabled: true,
						toolCount: 0,
						tools: [],
						latencyMs: elapsed(),
						error: { code: "verify_failed", message },
					},
					200,
				);
			} finally {
				// Best-effort cleanup; never let teardown leak through.
				await client.close().catch(() => {});
				await server.close().catch(() => {});
			}
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/connect/traffic",
			tags: ["connect"],
			summary: "Recent MCP traffic for the workspace",
			description:
				"Returns the in-memory ring buffer of recent MCP tool invocations for the workspace — drives the Connect tab's **Recent integration traffic** strip. Buffer is process-local and lossy on restart; the pino audit log remains the authoritative trail. Payload bodies are deliberately omitted (potential user-prompt / KB-id content).",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: ConnectTrafficQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: ConnectTrafficResponseSchema },
					},
					description:
						"Newest-first list of recent MCP invocations plus a 24h summary.",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const { limit } = c.req.valid("query");

			const workspace = await deps.store.getWorkspace(workspaceId);
			if (!workspace) {
				throw new ApiError(
					"workspace_not_found",
					`workspace '${workspaceId}' not found`,
					404,
				);
			}

			const entries = mcpTrafficBuffer.recent(workspaceId, { limit });
			const summary = mcpTrafficBuffer.summary(workspaceId);

			// No long cache here — clients poll this for "live" feel.
			// Cache-Control: no-store keeps a brief 304 cache from a
			// reverse proxy from making the strip look frozen.
			c.header("Cache-Control", "no-store");

			return c.json(
				{
					workspaceId,
					mcpEnabled: deps.mcpConfig.enabled,
					entries: [...entries],
					summary,
				},
				200,
			);
		},
	);

	return app;
}
