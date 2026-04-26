/**
 * `/api/v1/workspaces/{workspaceUid}/vector-stores` — descriptor CRUD
 * plus the data-plane endpoints.
 *
 * Descriptors (control plane):
 *   GET  /                         list
 *   POST /                         create descriptor + provision collection
 *   GET  /{vectorStoreUid}         fetch
 *   PUT  /{vectorStoreUid}         update descriptor
 *   DELETE /{vectorStoreUid}       drop collection + delete descriptor
 *
 * Data plane (Phase 1b):
 *   POST /{vectorStoreUid}/records upsert vectors
 *   DELETE /{vectorStoreUid}/records/{recordId} delete a vector
 *   POST /{vectorStoreUid}/search  vector search
 *
 * Descriptor create/delete are **transactional** end-to-end: a failure
 * on the data-plane step rolls the descriptor change back so the
 * two stores never drift.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { ApiError } from "../../lib/errors.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	AdoptableCollectionSchema,
	AdoptCollectionInputSchema,
	CreateVectorStoreInputSchema,
	DeleteRecordResponseSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	RecordIdParamSchema,
	SearchHitSchema,
	SearchRequestSchema,
	UpdateVectorStoreInputSchema,
	UpsertRequestSchema,
	UpsertResponseSchema,
	VectorStorePageSchema,
	VectorStoreRecordSchema,
	VectorStoreUidParamSchema,
	WorkspaceUidParamSchema,
} from "../../openapi/schemas.js";
import { dispatchSearch, toMutableHits } from "./search-dispatch.js";
import { dispatchUpsert } from "./upsert-dispatch.js";

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
			path: "/{workspaceUid}/vector-stores",
			tags: ["vector-stores"],
			summary: "List vector stores in a workspace",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: VectorStorePageSchema },
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
			const { workspaceUid } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceUid);
			const rows = await store.listVectorStores(workspaceUid);
			return c.json(paginate(rows, query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/vector-stores/discoverable",
			tags: ["vector-stores"],
			summary:
				"List collections that exist in the data plane but aren't yet wrapped in a workbench descriptor",
			description:
				"Walks the workspace driver's `listAdoptable` and filters out any collection that already has a descriptor row. Returned items can be turned into descriptors via `POST .../adopt`. Returns `[]` for drivers that don't expose a list (mock workspaces never have external collections).",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
			},
			responses: {
				200: {
					content: {
						"application/json": {
							schema: z.array(AdoptableCollectionSchema),
						},
					},
					description: "Adoptable collections (i.e. not yet adopted)",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
				503: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Driver for this workspace kind is not available",
				},
			},
		}),
		async (c) => {
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const workspace = await requireWorkspace(store, workspaceUid);
			const driver = drivers.for(workspace);
			if (typeof driver.listAdoptable !== "function") {
				return c.json([], 200);
			}
			const candidates = await driver.listAdoptable(workspace);
			const adopted = await store.listVectorStores(workspaceUid);
			const adoptedNames = new Set(adopted.map((d) => d.name));
			return c.json(
				candidates.filter((c) => !adoptedNames.has(c.name)),
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/vector-stores/adopt",
			tags: ["vector-stores"],
			summary:
				"Wrap an existing data-plane collection in a workbench descriptor",
			description:
				"Reads the live collection's vector / lexical / rerank options off the data plane and stamps a descriptor pointing at it — no `createCollection` round trip, since the collection already exists. Idempotent semantics are still on the caller: a second adopt call for an already-adopted name returns `409`.",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
				body: {
					content: {
						"application/json": { schema: AdoptCollectionInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: VectorStoreRecordSchema },
					},
					description: "Descriptor created over the existing collection",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or named collection not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"A descriptor with that collection name is already adopted",
				},
				503: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Driver doesn't support adoption (no listAdoptable)",
				},
			},
		}),
		async (c) => {
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const { collectionName } = c.req.valid("json");
			const workspace = await requireWorkspace(store, workspaceUid);

			const adopted = await store.listVectorStores(workspaceUid);
			if (adopted.some((d) => d.name === collectionName)) {
				throw new ApiError(
					"collection_already_adopted",
					`a vector-store descriptor already wraps collection '${collectionName}' in this workspace`,
					409,
				);
			}

			const driver = drivers.for(workspace);
			if (typeof driver.listAdoptable !== "function") {
				throw new ApiError(
					"adopt_not_supported",
					`driver for workspace kind '${workspace.kind}' doesn't expose listAdoptable`,
					503,
				);
			}

			const candidates = await driver.listAdoptable(workspace);
			const match = candidates.find((c) => c.name === collectionName);
			if (!match) {
				throw new ControlPlaneNotFoundError("collection", collectionName);
			}

			// Build a descriptor that mirrors the live collection's options.
			// `embedding.provider` defaults to "external" when the collection
			// has no $vectorize service — the workbench's descriptor
			// schema requires an EmbeddingConfig, and "external" signals
			// "client supplies the vector" the same way our other code paths
			// already treat unknown providers.
			const descriptor = await store.createVectorStore(workspaceUid, {
				name: match.name,
				vectorDimension: match.vectorDimension,
				vectorSimilarity: match.vectorSimilarity,
				embedding: {
					provider: match.embedding?.provider ?? "external",
					model: match.embedding?.model ?? "external",
					endpoint: null,
					dimension: match.vectorDimension,
					secretRef: null,
				},
				lexical: {
					enabled: match.lexicalEnabled,
					analyzer: null,
					options: {},
				},
				reranking: {
					enabled: match.rerankEnabled,
					provider: match.rerankProvider,
					model: match.rerankModel,
					endpoint: null,
					secretRef: null,
				},
			});
			return c.json(descriptor, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/vector-stores",
			tags: ["vector-stores"],
			summary: "Create a vector store (descriptor + underlying collection)",
			description:
				"Writes the descriptor row AND provisions the underlying Data API collection via the workspace's driver. If collection provisioning fails, the descriptor is rolled back.",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
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
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const workspace = await requireWorkspace(store, workspaceUid);

			// 1. Descriptor insert (can throw conflict).
			const descriptor = await store.createVectorStore(workspaceUid, body);

			// 2. Collection provisioning. Roll back the descriptor on failure so
			//    the control plane and the data plane don't drift.
			try {
				const driver = drivers.for(workspace);
				await driver.createCollection({ workspace, descriptor });
			} catch (err) {
				await store.deleteVectorStore(workspaceUid, descriptor.uid);
				throw err;
			}
			return c.json(descriptor, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/vector-stores/{vectorStoreUid}",
			tags: ["vector-stores"],
			summary: "Get a vector store descriptor",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					vectorStoreUid: VectorStoreUidParamSchema,
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
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "A catalog still references this vector store",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, vectorStoreUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const descriptor = await requireDescriptor(
				store,
				workspaceUid,
				vectorStoreUid,
			);
			return c.json(descriptor, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceUid}/vector-stores/{vectorStoreUid}",
			tags: ["vector-stores"],
			summary: "Update a vector store descriptor",
			description:
				"Descriptor-only. The underlying collection is NOT re-provisioned; changing vectorDimension on a populated store is a data-migration operation not yet supported.",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					vectorStoreUid: VectorStoreUidParamSchema,
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
			const { workspaceUid, vectorStoreUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.updateVectorStore(
				workspaceUid,
				vectorStoreUid,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}/vector-stores/{vectorStoreUid}",
			tags: ["vector-stores"],
			summary: "Delete a vector store (drops the collection)",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					vectorStoreUid: VectorStoreUidParamSchema,
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
			const { workspaceUid, vectorStoreUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const workspace = await requireWorkspace(store, workspaceUid);
			const descriptor = await store.getVectorStore(
				workspaceUid,
				vectorStoreUid,
			);
			if (!descriptor) {
				throw new ControlPlaneNotFoundError("vector store", vectorStoreUid);
			}
			// Drop collection first; if the driver is OK with idempotent drops,
			// a subsequent retry still works. If this fails, the descriptor
			// survives so the operator can inspect.
			await assertVectorStoreNotReferenced(store, workspaceUid, vectorStoreUid);
			const driver = drivers.for(workspace);
			await driver.dropCollection({ workspace, descriptor });
			await store.deleteVectorStore(workspaceUid, vectorStoreUid);
			return c.body(null, 204);
		},
	);

	/* ---------------- Data plane ---------------- */

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/vector-stores/{vectorStoreUid}/records",
			tags: ["vector-stores"],
			summary: "Upsert vector records",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					vectorStoreUid: VectorStoreUidParamSchema,
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
			const { workspaceUid, vectorStoreUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const workspace = await requireWorkspace(store, workspaceUid);
			const descriptor = await requireDescriptor(
				store,
				workspaceUid,
				vectorStoreUid,
			);
			const driver = drivers.for(workspace);
			const res = await dispatchUpsert({
				ctx: { workspace, descriptor },
				driver,
				embedders,
				records: body.records,
			});
			return c.json(res, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}/vector-stores/{vectorStoreUid}/records/{recordId}",
			tags: ["vector-stores"],
			summary: "Delete a vector record",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					vectorStoreUid: VectorStoreUidParamSchema,
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
			const { workspaceUid, vectorStoreUid, recordId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const workspace = await requireWorkspace(store, workspaceUid);
			const descriptor = await requireDescriptor(
				store,
				workspaceUid,
				vectorStoreUid,
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
			path: "/{workspaceUid}/vector-stores/{vectorStoreUid}/search",
			tags: ["vector-stores"],
			summary: "Vector search",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					vectorStoreUid: VectorStoreUidParamSchema,
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
			const { workspaceUid, vectorStoreUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const workspace = await requireWorkspace(store, workspaceUid);
			const descriptor = await requireDescriptor(
				store,
				workspaceUid,
				vectorStoreUid,
			);
			const driver = drivers.for(workspace);
			const ctx = { workspace, descriptor };
			const hits = await dispatchSearch({ ctx, driver, body, embedders });
			return c.json(toMutableHits(hits), 200);
		},
	);

	return app;
}

async function assertVectorStoreNotReferenced(
	store: ControlPlaneStore,
	workspaceUid: string,
	descriptorUid: string,
): Promise<void> {
	const catalogs = await store.listCatalogs(workspaceUid);
	const ref = catalogs.find((c) => c.vectorStore === descriptorUid);
	if (ref) {
		throw new ControlPlaneConflictError(
			`vector store '${descriptorUid}' is referenced by catalog '${ref.uid}'`,
		);
	}
}
