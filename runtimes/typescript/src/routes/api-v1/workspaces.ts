/**
 * `/api/v1/workspaces` — workspace CRUD routes.
 *
 * Handlers are intentionally thin: validate via Zod (automatic via the
 * OpenAPIHono route definition), delegate to the {@link ControlPlaneStore},
 * return the response. ControlPlane* errors bubble to the top-level
 * `onError` handler which translates them to the canonical envelope.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	assertWorkspaceAccess,
	filterToAccessibleWorkspaces,
} from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { makeOpenApi } from "../../lib/openapi.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateWorkspaceInputSchema,
	ErrorEnvelopeSchema,
	TestConnectionResponseSchema,
	UpdateWorkspaceInputSchema,
	WorkspaceIdParamSchema,
	WorkspaceRecordSchema,
} from "../../openapi/schemas.js";
import type { SecretResolver } from "../../secrets/provider.js";

export interface WorkspaceRouteDeps {
	readonly store: ControlPlaneStore;
	readonly secrets: SecretResolver;
}

export function workspaceRoutes(deps: WorkspaceRouteDeps): OpenAPIHono<AppEnv> {
	const { store, secrets } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/",
			tags: ["workspaces"],
			summary: "List workspaces",
			responses: {
				200: {
					content: {
						"application/json": { schema: z.array(WorkspaceRecordSchema) },
					},
					description: "All workspaces",
				},
			},
		}),
		async (c) => {
			const rows = await store.listWorkspaces();
			// Scoped callers only see workspaces their subject can touch;
			// anonymous / unscoped callers see everything.
			return c.json([...filterToAccessibleWorkspaces(c, rows)], 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/",
			tags: ["workspaces"],
			summary: "Create a workspace",
			request: {
				body: {
					content: {
						"application/json": { schema: CreateWorkspaceInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: WorkspaceRecordSchema } },
					description: "Workspace created",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate uid",
				},
			},
		}),
		async (c) => {
			const body = c.req.valid("json");
			const record = await store.createWorkspace(body);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}",
			tags: ["workspaces"],
			summary: "Get a workspace",
			request: { params: z.object({ workspaceId: WorkspaceIdParamSchema }) },
			responses: {
				200: {
					content: { "application/json": { schema: WorkspaceRecordSchema } },
					description: "Workspace",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getWorkspace(workspaceId);
			if (!record)
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceId}",
			tags: ["workspaces"],
			summary: "Update a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: UpdateWorkspaceInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: WorkspaceRecordSchema } },
					description: "Updated workspace",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateWorkspace(workspaceId, body);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}",
			tags: ["workspaces"],
			summary:
				"Delete a workspace (cascades to catalogs/vector stores/documents)",
			request: { params: z.object({ workspaceId: WorkspaceIdParamSchema }) },
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const { deleted } = await store.deleteWorkspace(workspaceId);
			if (!deleted)
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			return c.body(null, 204);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/test-connection",
			tags: ["workspaces"],
			summary: "Verify the workspace's credential refs can be resolved",
			description:
				"For `mock` workspaces, always returns `{ok: true}` (no credentials). For other kinds, resolves every value in `credentialsRef` via the runtime's SecretResolver and reports the first failure. This verifies refs only — it does NOT dial the backend or validate the resolved token against the remote service.",
			request: { params: z.object({ workspaceId: WorkspaceIdParamSchema }) },
			responses: {
				200: {
					content: {
						"application/json": { schema: TestConnectionResponseSchema },
					},
					description:
						"Connection probe result. `ok: true` means every credential ref resolved cleanly (or the workspace has no credentials). `ok: false` means at least one ref failed; `details` names which one and why.",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const ws = await store.getWorkspace(workspaceId);
			if (!ws) throw new ControlPlaneNotFoundError("workspace", workspaceId);

			if (ws.kind === "mock") {
				return c.json(
					{
						ok: true,
						kind: ws.kind,
						details:
							"Mock backend is always reachable. No credentials required.",
					},
					200,
				);
			}

			const entries = Object.entries(ws.credentialsRef);
			for (const [name, ref] of entries) {
				try {
					await secrets.resolve(ref);
				} catch (err) {
					const reason = err instanceof Error ? err.message : String(err);
					return c.json(
						{
							ok: false,
							kind: ws.kind,
							details: `credential '${name}' could not be resolved: ${reason}`,
						},
						200,
					);
				}
			}

			const summary =
				entries.length === 0
					? "No credentials configured. Nothing to verify yet — add a credentialsRef entry to enable probing."
					: `${entries.length} ${entries.length === 1 ? "credential" : "credentials"} resolved. Note: this verifies refs only, not the backend token against the remote service.`;
			return c.json({ ok: true, kind: ws.kind, details: summary }, 200);
		},
	);

	return app;
}
