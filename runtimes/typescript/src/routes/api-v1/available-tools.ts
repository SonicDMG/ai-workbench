/**
 * `/api/v1/workspaces/{workspaceId}/available-tools` — the selectable
 * agent-tool catalog (0.4.0 A6).
 *
 * Read-only. Composes the FULL candidate tool pool for the workspace —
 * built-in workspace tools + native (`native:fetch`, `native:web_search`)
 * + Astra (`astra:data_api`) + remote-MCP (`mcp:{serverId}:{tool}`) —
 * regardless of any agent's `toolIds` allow-list, so the agent form can
 * offer choices. The pool reflects what is actually wired for the
 * workspace: native tools only when configured, the Astra tool only for
 * astra/hcd workspaces, remote-MCP tools per registered+enabled server.
 *
 * The provider seam lives in `chat/tools/registry.ts`
 * ({@link listCandidateTools}); this module is just the workspace-scoped
 * HTTP front door. It is a `read` — the global `mutatingRouteWriteScope`
 * middleware only gates mutations.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { listCandidateTools } from "../../chat/tools/registry.js";
import type { ChatConfig } from "../../config/schema.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { logger } from "../../lib/logger.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import type { AppEnv } from "../../lib/types.js";
import {
	AvailableToolListSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import type { SecretResolver } from "../../secrets/provider.js";

export interface AvailableToolsRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly secrets: SecretResolver;
	/** Mirrors the runtime config; gates native tool availability. */
	readonly chatConfig: ChatConfig | null;
}

export function availableToolsRoutes(
	deps: AvailableToolsRouteDeps,
): OpenAPIHono<AppEnv> {
	const { store, drivers, embedders, secrets, chatConfig } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/available-tools",
			tags: ["agents"],
			summary: "List the selectable agent tool catalog",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: AvailableToolListSchema },
					},
					description:
						"Every tool an agent in this workspace may add to its allow-list",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			// Surface a clean 404 for an unknown workspace before doing any
			// provider discovery (which would otherwise throw a less precise
			// store error mid-composition).
			const workspace = await store.getWorkspace(workspaceId);
			if (!workspace) {
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			}
			const items = await listCandidateTools({
				workspaceId,
				store,
				drivers,
				embedders,
				secrets,
				chatConfig,
				logger,
			});
			return c.json({ items: [...items] }, 200);
		},
	);

	return app;
}
