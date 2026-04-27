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
	WorkspacePageSchema,
	WorkspaceRecordSchema,
	WorkspaceUidParamSchema,
} from "../../openapi/schemas.js";
import type { SecretResolver } from "../../secrets/provider.js";
import { resolveKb } from "./kb-descriptor.js";

export interface WorkspaceRouteDeps {
	readonly store: ControlPlaneStore;
	readonly secrets: SecretResolver;
	readonly drivers: VectorStoreDriverRegistry;
}

export function workspaceRoutes(deps: WorkspaceRouteDeps): OpenAPIHono<AppEnv> {
	const { store, secrets, drivers } = deps;
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
			return c.json(
				paginate([...filterToAccessibleWorkspaces(c, rows)], query),
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
					description: "Duplicate uid",
				},
			},
		}),
		async (c) => {
			assertPlatformAccess(c);
			const body = c.req.valid("json");
			const record = await store.createWorkspace(body);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}",
			tags: ["workspaces"],
			summary: "Get a workspace",
			request: { params: z.object({ workspaceUid: WorkspaceUidParamSchema }) },
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
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const record = await store.getWorkspace(workspaceUid);
			if (!record)
				throw new ControlPlaneNotFoundError("workspace", workspaceUid);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceUid}",
			tags: ["workspaces"],
			summary: "Update a workspace",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
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
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.updateWorkspace(workspaceUid, body);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}",
			tags: ["workspaces"],
			summary:
				"Delete a workspace (cascades to KBs, services, documents, and their collections)",
			request: { params: z.object({ workspaceUid: WorkspaceUidParamSchema }) },
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const workspace = await store.getWorkspace(workspaceUid);
			if (!workspace)
				throw new ControlPlaneNotFoundError("workspace", workspaceUid);
			// Resolve every KB into a driver descriptor, drop their
			// collections, then delete the workspace row (which cascades
			// the rest of the schema).
			const kbs = await store.listKnowledgeBases(workspaceUid);
			const descriptors: VectorStoreRecord[] = [];
			for (const kb of kbs) {
				const resolved = await resolveKb(
					store,
					workspaceUid,
					kb.knowledgeBaseId,
				);
				descriptors.push(resolved.descriptor);
			}
			await dropWorkspaceCollections({ workspace, descriptors, drivers });
			const { deleted } = await store.deleteWorkspace(workspaceUid);
			if (!deleted)
				throw new ControlPlaneNotFoundError("workspace", workspaceUid);
			return c.body(null, 204);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/test-connection",
			tags: ["workspaces"],
			summary: "Verify the workspace's credential refs can be resolved",
			description:
				"For `mock` workspaces, always returns `{ok: true}` (no credentials). For other kinds, resolves every value in `credentialsRef` via the runtime's SecretResolver and reports the first failure. This verifies refs only — it does NOT dial the backend or validate the resolved token against the remote service.",
			request: { params: z.object({ workspaceUid: WorkspaceUidParamSchema }) },
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
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const ws = await store.getWorkspace(workspaceUid);
			if (!ws) throw new ControlPlaneNotFoundError("workspace", workspaceUid);

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
					return c.json(
						{
							ok: false,
							kind: ws.kind,
							details: `credential '${name}' could not be resolved: ${safeErrorMessage(err, "secret resolution failed")}`,
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
