/**
 * `/api/v1/workspaces/{workspaceId}/vector-stores` — descriptor CRUD.
 *
 * This surface manages the DEFINITION rows in
 * `wb_vector_store_by_workspace`. Provisioning the underlying Data API
 * Collection is a Phase 1b concern; this PR only tracks descriptors.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateVectorStoreInputSchema,
	ErrorEnvelopeSchema,
	UpdateVectorStoreInputSchema,
	VectorStoreIdParamSchema,
	VectorStoreRecordSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

export function vectorStoreRoutes(
	store: ControlPlaneStore,
): OpenAPIHono<AppEnv> {
	const app = new OpenAPIHono<AppEnv>();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/vector-stores",
			tags: ["vector-stores"],
			summary: "List vector stores in a workspace",
			request: { params: z.object({ workspaceId: WorkspaceIdParamSchema }) },
			responses: {
				200: {
					content: {
						"application/json": {
							schema: z.array(VectorStoreRecordSchema),
						},
					},
					description: "All vector store descriptors in the workspace",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const rows = await store.listVectorStores(workspaceId);
			return c.json([...rows], 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/vector-stores",
			tags: ["vector-stores"],
			summary: "Create a vector store descriptor in a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateVectorStoreInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: VectorStoreRecordSchema },
					},
					description: "Vector store descriptor created",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate uid",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.createVectorStore(workspaceId, body);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/vector-stores/{vectorStoreId}",
			tags: ["vector-stores"],
			summary: "Get a vector store descriptor",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					vectorStoreId: VectorStoreIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: VectorStoreRecordSchema },
					},
					description: "Vector store descriptor",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or vector store not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, vectorStoreId } = c.req.valid("param");
			const record = await store.getVectorStore(workspaceId, vectorStoreId);
			if (!record) {
				throw new ControlPlaneNotFoundError("vector store", vectorStoreId);
			}
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceId}/vector-stores/{vectorStoreId}",
			tags: ["vector-stores"],
			summary: "Update a vector store descriptor",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					vectorStoreId: VectorStoreIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateVectorStoreInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: VectorStoreRecordSchema },
					},
					description: "Updated vector store descriptor",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or vector store not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, vectorStoreId } = c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.updateVectorStore(
				workspaceId,
				vectorStoreId,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/vector-stores/{vectorStoreId}",
			tags: ["vector-stores"],
			summary: "Delete a vector store descriptor",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					vectorStoreId: VectorStoreIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or vector store not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, vectorStoreId } = c.req.valid("param");
			const { deleted } = await store.deleteVectorStore(
				workspaceId,
				vectorStoreId,
			);
			if (!deleted) {
				throw new ControlPlaneNotFoundError("vector store", vectorStoreId);
			}
			return c.body(null, 204);
		},
	);

	return app;
}
