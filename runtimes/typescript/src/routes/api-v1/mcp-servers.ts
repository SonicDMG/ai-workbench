/**
 * `/api/v1/workspaces/{workspaceId}/mcp-servers` — external MCP server
 * registry CRUD (0.4.0 A2).
 *
 * Each row is a remote MCP server the workspace's agents may reach over
 * Streamable HTTP. The agent tool resolver lists the enabled servers,
 * connects to each, and adapts every discovered tool into an agent tool
 * named `mcp:{mcpServerId}:{toolName}` (see
 * `chat/tools/providers/remote-mcp.ts`).
 *
 * Scope: registering an MCP server is **workspace content**, not an admin
 * operation, so mutations are gated to `write` by the global
 * `mutatingRouteWriteScope` middleware — these routes do NOT graduate to
 * `manage` (unlike api-keys / principals / policy). The `/mcp-servers`
 * suffix is deliberately distinct from the `/mcp` JSON-RPC route, so it is
 * NOT on the `mutatingRouteWriteScope` read-shaped allowlist: a write-only
 * key can register a server, a read-only key cannot.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { invalidateMcpServer } from "../../chat/tools/mcp-discovery-cache.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateMcpServerInputSchema,
	McpServerIdParamSchema,
	McpServerPageSchema,
	McpServerRecordSchema,
	PaginationQuerySchema,
	UpdateMcpServerInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { toWireMcpServer, toWirePage } from "./serdes/index.js";

export function mcpServerRoutes(store: ControlPlaneStore): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/mcp-servers",
			tags: ["mcp-servers"],
			summary: "List registered external MCP servers",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: McpServerPageSchema },
					},
					description: "All MCP servers registered in the workspace",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const query = c.req.valid("query");
			const rows = await store.listMcpServers(workspaceId);
			return c.json(toWirePage(paginate(rows, query), toWireMcpServer), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/mcp-servers",
			tags: ["mcp-servers"],
			summary: "Register an external MCP server",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateMcpServerInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: McpServerRecordSchema },
					},
					description: "MCP server registered",
				},
				...errorResponse(404, "Workspace not found"),
				...errorResponse(409, "MCP server already exists"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.createMcpServer(workspaceId, body);
			return c.json(toWireMcpServer(record), 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/mcp-servers/{mcpServerId}",
			tags: ["mcp-servers"],
			summary: "Get a single MCP server",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					mcpServerId: McpServerIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: McpServerRecordSchema },
					},
					description: "MCP server record",
				},
				...errorResponse(404, "Workspace or MCP server not found"),
			},
		}),
		async (c) => {
			const { workspaceId, mcpServerId } = c.req.valid("param");
			const record = await store.getMcpServer(workspaceId, mcpServerId);
			if (!record)
				throw new ControlPlaneNotFoundError("mcp server", mcpServerId);
			return c.json(toWireMcpServer(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/mcp-servers/{mcpServerId}",
			tags: ["mcp-servers"],
			summary: "Update an MCP server",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					mcpServerId: McpServerIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateMcpServerInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: McpServerRecordSchema },
					},
					description: "Updated MCP server",
				},
				...errorResponse(404, "Workspace or MCP server not found"),
			},
		}),
		async (c) => {
			const { workspaceId, mcpServerId } = c.req.valid("param");
			const body = c.req.valid("json");
			const updated = await store.updateMcpServer(
				workspaceId,
				mcpServerId,
				body,
			);
			// Drop any cached discovery — url / credentialRef / allowedTools
			// may have changed, so the next turn must re-list.
			invalidateMcpServer(workspaceId, mcpServerId);
			return c.json(toWireMcpServer(updated), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/mcp-servers/{mcpServerId}",
			tags: ["mcp-servers"],
			summary: "Delete an MCP server",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					mcpServerId: McpServerIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				...errorResponse(404, "Workspace or MCP server not found"),
			},
		}),
		async (c) => {
			const { workspaceId, mcpServerId } = c.req.valid("param");
			const { deleted } = await store.deleteMcpServer(workspaceId, mcpServerId);
			if (!deleted)
				throw new ControlPlaneNotFoundError("mcp server", mcpServerId);
			// Drop cached discovery for the now-deleted server.
			invalidateMcpServer(workspaceId, mcpServerId);
			return c.body(null, 204);
		},
	);

	return app;
}
