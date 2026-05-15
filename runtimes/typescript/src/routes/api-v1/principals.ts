/**
 * `/api/v1/workspaces/{workspaceId}/principals` — RLAC sub-workspace
 * identity CRUD.
 *
 * Principals are the "users" the policy DSL evaluates against. They
 * are intentionally workspace-scoped strings (not UUIDs) — typically
 * OIDC `sub` values, email addresses, or operator-chosen handles.
 * The policy DSL references them via `current_principal_id()` (the
 * caller's principal) and `$principal.<attribute>` lookups.
 *
 * See `docs/rlac-prototype/data-api-design-ask.md` for the model.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { audit } from "../../lib/audit.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreatePrincipalInputSchema,
	PaginationQuerySchema,
	PrincipalIdParamSchema,
	PrincipalPageSchema,
	PrincipalRecordSchema,
	UpdatePrincipalInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

export function principalRoutes(store: ControlPlaneStore): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/principals",
			tags: ["rlac", "principals"],
			summary: "List principals (RLAC sub-workspace identities)",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: PrincipalPageSchema },
					},
					description: "All principals in the workspace",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const query = c.req.valid("query");
			const rows = await store.listPrincipals(workspaceId);
			return c.json(paginate(rows, query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/principals",
			tags: ["rlac", "principals"],
			summary: "Create a principal",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreatePrincipalInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: PrincipalRecordSchema },
					},
					description: "Principal created",
				},
				...errorResponse(404, "Workspace not found"),
				...errorResponse(409, "Principal already exists"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.createPrincipal(workspaceId, body);
			audit(c, {
				action: "principal.create",
				outcome: "success",
				workspaceId,
				details: { principalId: record.principalId },
			});
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/principals/{principalId}",
			tags: ["rlac", "principals"],
			summary: "Get a single principal",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					principalId: PrincipalIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: PrincipalRecordSchema },
					},
					description: "Principal record",
				},
				...errorResponse(404, "Workspace or principal not found"),
			},
		}),
		async (c) => {
			const { workspaceId, principalId } = c.req.valid("param");
			const record = await store.getPrincipal(workspaceId, principalId);
			if (!record)
				throw new ControlPlaneNotFoundError("principal", principalId);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/principals/{principalId}",
			tags: ["rlac", "principals"],
			summary: "Update a principal",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					principalId: PrincipalIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdatePrincipalInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: PrincipalRecordSchema },
					},
					description: "Updated principal",
				},
				...errorResponse(404, "Workspace or principal not found"),
			},
		}),
		async (c) => {
			const { workspaceId, principalId } = c.req.valid("param");
			const body = c.req.valid("json");
			const updated = await store.updatePrincipal(
				workspaceId,
				principalId,
				body,
			);
			audit(c, {
				action: "principal.update",
				outcome: "success",
				workspaceId,
				details: { principalId },
			});
			return c.json(updated, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/principals/{principalId}",
			tags: ["rlac", "principals"],
			summary: "Delete a principal",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					principalId: PrincipalIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				...errorResponse(404, "Workspace or principal not found"),
			},
		}),
		async (c) => {
			const { workspaceId, principalId } = c.req.valid("param");
			const { deleted } = await store.deletePrincipal(workspaceId, principalId);
			if (!deleted)
				throw new ControlPlaneNotFoundError("principal", principalId);
			audit(c, {
				action: "principal.delete",
				outcome: "success",
				workspaceId,
				details: { principalId },
			});
			return c.body(null, 204);
		},
	);

	return app;
}
