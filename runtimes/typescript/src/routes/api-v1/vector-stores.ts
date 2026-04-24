/**
 * `/api/v1/workspaces/{workspaceId}/vector-stores` — descriptor CRUD
 * plus the data-plane endpoints.
 *
 * Descriptors (control plane):
 *   GET  /                         list
 *   POST /                         create descriptor + provision collection
 *   GET  /{id}                     fetch
 *   PUT  /{id}                     update descriptor
 *   DELETE /{id}                   drop collection + delete descriptor
 *
 * Data plane (Phase 1b):
 *   POST /{id}/records             upsert vectors
 *   DELETE /{id}/records/{rid}     delete a vector
 *   POST /{id}/search              vector search
 *
 * Descriptor create/delete are **transactional** end-to-end: a failure
 * on the data-plane step rolls the descriptor change back so the
 * two stores never drift.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import { NotSupportedError } from "../../drivers/vector-store.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { ApiError } from "../../lib/errors.js";
import { makeOpenApi } from "../../lib/openapi.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateVectorStoreInputSchema,
	DeleteRecordResponseSchema,
	ErrorEnvelopeSchema,
	RecordIdParamSchema,
	SearchHitSchema,
	SearchRequestSchema,
	UpdateVectorStoreInputSchema,
	UpsertRequestSchema,
	UpsertResponseSchema,
	VectorStoreIdParamSchema,
	VectorStoreRecordSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

export interface VectorStoreRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
}

async function requireWorkspace(
	store: ControlPlaneStore,
	uid: string,
): Promise<WorkspaceRecord> {
	const ws = await store.getWorkspace(uid);
	if (!ws) throw new ControlPlaneNotFoundError("workspace", uid);
	return ws;
}

async function requireDescriptor(
	store: ControlPlaneStore,
	workspaceUid: string,
	descriptorUid: string,
): Promise<VectorStoreRecord> {
	const descriptor = await store.getVectorStore(workspaceUid, descriptorUid);
	if (!descriptor)
		throw new ControlPlaneNotFoundError("vector store", descriptorUid);
	return descriptor;
}

export function vectorStoreRoutes(
	deps: VectorStoreRouteDeps,
): OpenAPIHono<AppEnv> {
	const { store, drivers, embedders } = deps;
	const app = makeOpenApi();

	/* ---------------- Descriptor CRUD ---------------- */

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
						"application/json": { schema: z.array(VectorStoreRecordSchema) },
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
			assertWorkspaceAccess(c, workspaceId);
			const rows = await store.listVectorStores(workspaceId);
			return c.json([...rows], 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/vector-stores",
			tags: ["vector-stores"],
			summary: "Create a vector store (descriptor + underlying collection)",
			description:
				"Writes the descriptor row AND provisions the underlying Data API collection via the workspace's driver. If collection provisioning fails, the descriptor is rolled back.",
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
					description: "Vector store created and collection provisioned",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate uid",
				},
				503: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Driver for this workspace kind is not available",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const workspace = await requireWorkspace(store, workspaceId);

			// 1. Descriptor insert (can throw conflict).
			const descriptor = await store.createVectorStore(workspaceId, body);

			// 2. Collection provisioning. Roll back the descriptor on failure so
			//    the control plane and the data plane don't drift.
			try {
				const driver = drivers.for(workspace);
				await driver.createCollection({ workspace, descriptor });
			} catch (err) {
				await store.deleteVectorStore(workspaceId, descriptor.uid);
				throw err;
			}
			return c.json(descriptor, 201);
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
			assertWorkspaceAccess(c, workspaceId);
			const descriptor = await requireDescriptor(
				store,
				workspaceId,
				vectorStoreId,
			);
			return c.json(descriptor, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceId}/vector-stores/{vectorStoreId}",
			tags: ["vector-stores"],
			summary: "Update a vector store descriptor",
			description:
				"Descriptor-only. The underlying collection is NOT re-provisioned; changing vectorDimension on a populated store is a data-migration operation not yet supported.",
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
			assertWorkspaceAccess(c, workspaceId);
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
			summary: "Delete a vector store (drops the collection)",
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
			assertWorkspaceAccess(c, workspaceId);
			const workspace = await requireWorkspace(store, workspaceId);
			const descriptor = await store.getVectorStore(workspaceId, vectorStoreId);
			if (!descriptor) {
				throw new ControlPlaneNotFoundError("vector store", vectorStoreId);
			}
			// Drop collection first; if the driver is OK with idempotent drops,
			// a subsequent retry still works. If this fails, the descriptor
			// survives so the operator can inspect.
			const driver = drivers.for(workspace);
			await driver.dropCollection({ workspace, descriptor });
			await store.deleteVectorStore(workspaceId, vectorStoreId);
			return c.body(null, 204);
		},
	);

	/* ---------------- Data plane ---------------- */

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/vector-stores/{vectorStoreId}/records",
			tags: ["vector-stores"],
			summary: "Upsert vector records",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					vectorStoreId: VectorStoreIdParamSchema,
				}),
				body: {
					content: { "application/json": { schema: UpsertRequestSchema } },
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: UpsertResponseSchema } },
					description: "Upsert complete",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or vector store not found",
				},
				400: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Dimension mismatch or malformed request",
				},
			},
		}),
		async (c) => {
			const { workspaceId, vectorStoreId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const workspace = await requireWorkspace(store, workspaceId);
			const descriptor = await requireDescriptor(
				store,
				workspaceId,
				vectorStoreId,
			);
			const driver = drivers.for(workspace);
			const res = await driver.upsert({ workspace, descriptor }, body.records);
			return c.json(res, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/vector-stores/{vectorStoreId}/records/{recordId}",
			tags: ["vector-stores"],
			summary: "Delete a vector record",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					vectorStoreId: VectorStoreIdParamSchema,
					recordId: RecordIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: DeleteRecordResponseSchema },
					},
					description:
						"Delete attempted; `deleted` indicates whether a record was present",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or vector store not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, vectorStoreId, recordId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const workspace = await requireWorkspace(store, workspaceId);
			const descriptor = await requireDescriptor(
				store,
				workspaceId,
				vectorStoreId,
			);
			const driver = drivers.for(workspace);
			const res = await driver.deleteRecord(
				{ workspace, descriptor },
				recordId,
			);
			return c.json(res, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/vector-stores/{vectorStoreId}/search",
			tags: ["vector-stores"],
			summary: "Vector search",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					vectorStoreId: VectorStoreIdParamSchema,
				}),
				body: {
					content: { "application/json": { schema: SearchRequestSchema } },
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: z.array(SearchHitSchema) },
					},
					description: "Matching hits, highest score first",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or vector store not found",
				},
				400: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Dimension mismatch or malformed request",
				},
			},
		}),
		async (c) => {
			const { workspaceId, vectorStoreId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const workspace = await requireWorkspace(store, workspaceId);
			const descriptor = await requireDescriptor(
				store,
				workspaceId,
				vectorStoreId,
			);
			const driver = drivers.for(workspace);
			const ctx = { workspace, descriptor };

			// Three paths, picked in this order:
			//   1. body.vector → straight through to driver.search
			//   2. body.text + driver.searchByText present + doesn't
			//      throw NotSupported → server-side embedding (vectorize)
			//   3. body.text + fallback to client-side embedding via
			//      the descriptor's `embedding` config
			const hits = await runSearch({
				ctx,
				driver,
				body,
				embedders,
			});
			// Copy to mutable shape — route response inference requires
			// non-readonly arrays.
			const mutable = hits.map((h) => ({
				id: h.id,
				score: h.score,
				...(h.payload !== undefined && { payload: { ...h.payload } }),
				...(h.vector !== undefined && { vector: [...h.vector] }),
			}));
			return c.json(mutable, 200);
		},
	);

	return app;
}

async function runSearch(args: {
	ctx: { workspace: WorkspaceRecord; descriptor: VectorStoreRecord };
	driver: ReturnType<VectorStoreDriverRegistry["for"]>;
	embedders: EmbedderFactory;
	body: {
		vector?: number[];
		text?: string;
		topK?: number;
		filter?: Record<string, unknown>;
		includeEmbeddings?: boolean;
	};
}) {
	const { ctx, driver, embedders, body } = args;
	const sharedOpts = {
		topK: body.topK,
		filter: body.filter,
		includeEmbeddings: body.includeEmbeddings,
	};

	if (body.vector !== undefined) {
		return driver.search(ctx, { vector: body.vector, ...sharedOpts });
	}

	const text = body.text;
	if (text === undefined) {
		// Zod refinement already rejects this, but the extra check
		// satisfies the type narrower below.
		throw new ApiError(
			"validation_error",
			"exactly one of 'vector' or 'text' is required",
			400,
		);
	}

	// 1. Driver-native text search (vectorize). Skip on NotSupported.
	if (driver.searchByText) {
		try {
			return await driver.searchByText(ctx, { text, ...sharedOpts });
		} catch (err) {
			if (!(err instanceof NotSupportedError)) throw err;
		}
	}

	// 2. Client-side embedding + vector search.
	let embedder: Awaited<ReturnType<EmbedderFactory["forConfig"]>>;
	try {
		embedder = await embedders.forConfig(ctx.descriptor.embedding);
	} catch (err) {
		throw new ApiError(
			"embedding_unavailable",
			err instanceof Error
				? err.message
				: "embedding provider is not available for this vector store",
			400,
		);
	}
	if (embedder.dimension !== ctx.descriptor.vectorDimension) {
		throw new ApiError(
			"embedding_dimension_mismatch",
			`embedder returned dimension ${embedder.dimension} but vector store expects ${ctx.descriptor.vectorDimension}`,
			400,
		);
	}
	const vector = await embedder.embed(text);
	return driver.search(ctx, { vector, ...sharedOpts });
}
