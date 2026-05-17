/**
 * `/api/v1/workspaces/{workspaceId}/mcp` — Model Context Protocol
 * façade.
 *
 * Each request constructs a stateless MCP server scoped to the
 * workspace and delegates to the SDK's Streamable-HTTP transport.
 * Auth is the same as the rest of `/api/v1/workspaces/*`: the
 * app-level workspace authz wrapper keeps a scoped API key for
 * workspace A from calling MCP tools against workspace B.
 *
 * Off by default — `mcp.enabled: true` in `workbench.yaml` opts in.
 * When disabled the route returns `404 not_found` so the surface
 * isn't probeable from the wire.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AuthContext } from "../../auth/types.js";
import type { ChatService } from "../../chat/types.js";
import type { ChatConfig, McpConfig } from "../../config/schema.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { audit } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import type { AppEnv } from "../../lib/types.js";
import { handleMcpRequest } from "../../mcp/server.js";
import type { IngestService } from "../../services/ingest-service.js";
import type { KnowledgeBaseService } from "../../services/knowledge-base-service.js";

/**
 * Project the request's {@link AuthContext} onto the scope set the
 * MCP server will use to gate write tools. Mirrors the semantics in
 * `auth/authz.ts#assertScope`:
 *
 *   - missing context (middleware skipped this route) → `null`
 *     (no gate)
 *   - anonymous → `null` (gate already cleared by `anonymousPolicy`)
 *   - subject with `scopes: null` (OIDC / bootstrap) → `null`
 *   - subject with a concrete `scopes` array (API key) → that array
 *
 * Exported for reuse in the Connect tab's verify route, which builds
 * an in-process MCP server with the same gate semantics.
 */
export function subjectScopesFromAuth(
	auth: AuthContext | undefined,
): readonly string[] | null {
	if (!auth || auth.anonymous) return null;
	const scopes = auth.subject?.scopes;
	if (scopes === null || scopes === undefined) return null;
	return scopes;
}

export interface McpRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly chatService: ChatService | null;
	readonly chatConfig: ChatConfig | null;
	readonly mcpConfig: McpConfig;
	/**
	 * Shared ingest service. Drives the `ingest_text` MCP write tool —
	 * passed through verbatim so the MCP and REST ingest paths run the
	 * exact same dedup + chunk + embed pipeline. Null disables the
	 * write tool (read tools still register normally).
	 */
	readonly ingestService: IngestService | null;
	/**
	 * Shared knowledge-base service. Drives the `create_knowledge_base`
	 * and `delete_knowledge_base` MCP write tools — same instance the
	 * REST `/knowledge-bases` route uses, so the collection-provision +
	 * rollback semantics are identical across front doors. Null
	 * disables both write tools (read tools still register normally).
	 */
	readonly knowledgeBaseService: KnowledgeBaseService | null;
}

/**
 * Build the MCP sub-app — mounted by the route-plugin registry under
 * `/api/v1/workspaces`, so the visible path is
 * `/api/v1/workspaces/:workspaceId/mcp`.
 *
 * The MCP transport doesn't fit the OpenAPI route description (it's
 * JSON-RPC under the hood), so we register it as a plain catch-all on
 * the four methods the Streamable-HTTP spec uses (`GET`, `POST`,
 * `DELETE`, `OPTIONS`). The sub-app type is still `OpenAPIHono<AppEnv>`
 * to satisfy the {@link RoutePlugin.build} contract; it just contains
 * no OpenAPI-described routes.
 */
export function mcpRoutes(deps: McpRouteDeps): OpenAPIHono<AppEnv> {
	const app = new OpenAPIHono<AppEnv>();
	const handler = async (c: Context<AppEnv>) => {
		if (!deps.mcpConfig.enabled) {
			throw new ApiError(
				"not_found",
				"MCP is not enabled on this runtime; set `mcp.enabled: true` in workbench.yaml",
				404,
			);
		}
		const workspaceId = c.req.param("workspaceId");
		if (!workspaceId) {
			throw new ApiError("validation_error", "missing workspaceId", 400);
		}
		const ws = await deps.store.getWorkspace(workspaceId);
		if (!ws) {
			throw new ApiError(
				"workspace_not_found",
				`workspace '${workspaceId}' not found`,
				404,
			);
		}
		// Project the caller's scope set onto the MCP server so write
		// tools (`ingest_text`, `delete_document`) can refuse a
		// read-only key. `null` from `subjectScopesFromAuth` means
		// "no scope gate applies" — anonymous (dev mode) and OIDC /
		// bootstrap subjects pass through to the legacy behavior.
		const subjectScopes = subjectScopesFromAuth(c.get("auth"));
		return handleMcpRequest({
			workspaceId,
			request: c.req.raw,
			deps: {
				store: deps.store,
				drivers: deps.drivers,
				embedders: deps.embedders,
				chatService: deps.chatService,
				chatConfig: deps.chatConfig,
				exposeChat: deps.mcpConfig.exposeChat,
				ingestService: deps.ingestService,
				knowledgeBaseService: deps.knowledgeBaseService,
				subjectScopes,
				onToolInvoke: (info) => {
					audit(c, {
						action: "mcp.invoke",
						outcome: info.outcome,
						workspaceId,
						details: {
							toolName: info.toolName,
							...(info.reason ? { reason: info.reason } : {}),
						},
					});
				},
			},
		});
	};
	app.all("/:workspaceId/mcp", handler);
	return app;
}
