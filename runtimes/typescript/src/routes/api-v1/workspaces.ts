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
	assertPlatformAccess,
	assertWorkspaceAccess,
	filterToAccessibleWorkspaces,
} from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import { safeErrorMessage } from "../../lib/safe-error.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateWorkspaceInputSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	TestConnectionResponseSchema,
	UpdateWorkspaceInputSchema,
	WorkspaceIdParamSchema,
	WorkspacePageSchema,
	WorkspaceRecordSchema,
} from "../../openapi/schemas.js";
import type { SecretResolver } from "../../secrets/provider.js";
import { resolveKb } from "./kb-descriptor.js";

export interface WorkspaceRouteDeps {
	readonly store: ControlPlaneStore;
	readonly secrets: SecretResolver;
	readonly drivers: VectorStoreDriverRegistry;
}

export function workspaceRoutes(deps: WorkspaceRouteDeps): OpenAPIHono<AppEnv> {
	const { store, drivers } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/",
			tags: ["workspaces"],
			summary: "List workspaces",
			request: { query: PaginationQuerySchema },
			responses: {
				200: {
					content: {
						"application/json": { schema: WorkspacePageSchema },
					},
					description: "All workspaces",
				},
			},
		}),
		async (c) => {
			const query = c.req.valid("query");
			const rows = await store.listWorkspaces();
			// Scoped callers only see workspaces their subject can touch;
			// anonymous / unscoped callers see everything.
			const page = paginate([...filterToAccessibleWorkspaces(c, rows)], query);
			return c.json(
				{ items: page.items.map(toWireWorkspace), nextCursor: page.nextCursor },
				200,
			);
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
				403: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"Authenticated subject is scoped to specific workspaces and cannot create new ones",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate workspaceId",
				},
			},
		}),
		async (c) => {
			assertPlatformAccess(c);
			const body = c.req.valid("json");
			const record = await store.createWorkspace({
				...body,
				uid: body.workspaceId,
			});
			return c.json(toWireWorkspace(record), 201);
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
				503: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"Driver for this workspace kind is not available while dropping vector-store collections",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getWorkspace(workspaceId);
			if (!record)
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			return c.json(toWireWorkspace(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
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
			return c.json(toWireWorkspace(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}",
			tags: ["workspaces"],
			summary:
				"Delete a workspace (cascades to KBs, services, documents, and their collections)",
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
			const workspace = await store.getWorkspace(workspaceId);
			if (!workspace)
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			// Resolve every KB into a driver descriptor, drop their
			// collections, then delete the workspace row (which cascades
			// the rest of the schema).
			const kbs = await store.listKnowledgeBases(workspaceId);
			const descriptors: VectorStoreRecord[] = [];
			for (const kb of kbs) {
				const resolved = await resolveKb(
					store,
					workspaceId,
					kb.knowledgeBaseId,
				);
				descriptors.push(resolved.descriptor);
			}
			await dropWorkspaceCollections({ workspace, descriptors, drivers });
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
			summary: "Run a live workspace connection check",
			description:
				"For `mock` workspaces, always returns `{ok: true}`. For remote backends, resolves the workspace connection details and asks the driver to make a live data-plane call.",
			request: { params: z.object({ workspaceId: WorkspaceIdParamSchema }) },
			responses: {
				200: {
					content: {
						"application/json": { schema: TestConnectionResponseSchema },
					},
					description:
						"Connection check result. `ok: true` means the driver completed its live check. `ok: false` means the driver could not reach or authenticate with the backend.",
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

			try {
				const driver = drivers.for(ws);
				const live = driver.testConnection
					? await driver.testConnection(ws)
					: {
							ok: false,
							details: `driver for workspace kind '${ws.kind}' does not implement a live connection check`,
						};
				return c.json(
					{
						ok: live.ok,
						kind: ws.kind,
						details: live.details,
					},
					200,
				);
			} catch (err) {
				return c.json(
					{
						ok: false,
						kind: ws.kind,
						details: safeErrorMessage(err, "connection check failed"),
					},
					200,
				);
			}
		},
	);

	return app;
}

async function dropWorkspaceCollections(args: {
	readonly workspace: WorkspaceRecord;
	readonly descriptors: readonly VectorStoreRecord[];
	readonly drivers: VectorStoreDriverRegistry;
}): Promise<void> {
	const { workspace, descriptors, drivers } = args;
	if (descriptors.length === 0) return;
	const driver = drivers.for(workspace);
	for (const descriptor of descriptors) {
		await driver.dropCollection({ workspace, descriptor });
	}
}

function toWireWorkspace(record: WorkspaceRecord) {
	const { uid, ...rest } = record;
	return { workspaceId: uid, ...rest };
}
