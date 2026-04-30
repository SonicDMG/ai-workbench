/**
 * `/api/v1/workspaces/{workspaceId}/mcp` — Model Context Protocol
 * façade.
 *
 * Each request constructs a stateless MCP server scoped to the
 * workspace and delegates to the SDK's Streamable-HTTP transport.
 * Auth is the same as the rest of `/api/v1/workspaces/*`: a scoped
 * API key for workspace A cannot call MCP tools against workspace B.
 *
 * Off by default — `mcp.enabled: true` in `workbench.yaml` opts in.
 * When disabled the route returns `404 not_found` so the surface
 * isn't probeable from the wire.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import type { ChatService } from "../../chat/types.js";
import type { ChatConfig, McpConfig } from "../../config/schema.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { ApiError } from "../../lib/errors.js";
import type { AppEnv } from "../../lib/types.js";
import { handleMcpRequest } from "../../mcp/server.js";

export interface McpRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly chatService: ChatService | null;
	readonly chatConfig: ChatConfig | null;
	readonly mcpConfig: McpConfig;
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
		assertWorkspaceAccess(c, workspaceId);
		const ws = await deps.store.getWorkspace(workspaceId);
		if (!ws) {
			throw new ApiError(
				"workspace_not_found",
				`workspace '${workspaceId}' not found`,
				404,
			);
		}
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
			},
		});
	};
	app.all("/:workspaceId/mcp", handler);
	return app;
}
