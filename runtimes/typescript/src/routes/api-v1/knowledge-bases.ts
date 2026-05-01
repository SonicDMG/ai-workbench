/**
 * `/api/v1/workspaces/{workspaceId}/knowledge-bases` — Knowledge-Base
 * CRUD (issue #98).
 *
 * Replaces `/catalogs/*`. Coexists with the legacy catalog routes
 * during phase 1b; phase 1c removes the catalog surface entirely.
 *
 * This file is the control-plane CRUD only. Documents, ingest, and
 * search continue to flow through the legacy paths until those
 * subsystems are rewired (follow-up phase).
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import { DimensionMismatchError } from "../../drivers/vector-store.js";
import { ApiError } from "../../lib/errors.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	AdoptableCollectionListSchema,
	CreateKnowledgeBaseInputSchema,
	KnowledgeBaseIdParamSchema,
	KnowledgeBasePageSchema,
	KnowledgeBaseRecordSchema,
	PaginationQuerySchema,
	UpdateKnowledgeBaseInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { resolveKb } from "./kb-descriptor.js";

export interface KnowledgeBaseRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
}

export function knowledgeBaseRoutes(
	deps: KnowledgeBaseRouteDeps,
): OpenAPIHono<AppEnv> {
	const { store, drivers } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/knowledge-bases",
			tags: ["knowledge-bases"],
			summary: "List knowledge bases in a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: KnowledgeBasePageSchema },
					},
					description: "All knowledge bases in the workspace",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceId);
			const rows = await store.listKnowledgeBases(workspaceId);
			return c.json(paginate(rows, query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/knowledge-bases",
			tags: ["knowledge-bases"],
			summary: "Create a knowledge base in a workspace",
			description:
				"Creates a KB bound to existing chunking + embedding (and optional reranking) services. The vector collection is auto-provisioned from the embedding service's dimension and distance metric, named `wb_vectors_<kb_id>` unless overridden.",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateKnowledgeBaseInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: KnowledgeBaseRecordSchema },
					},
					description: "Knowledge base created",
				},
				...errorResponse(
					400,
					"Attach payload is malformed (missing `vectorCollection`, embedding service mismatch, or vector-dimension mismatch)",
				),
				...errorResponse(
					404,
					"Workspace, embedding service, chunking service, reranking service, or attach-target collection not found",
				),
				...errorResponse(409, "Duplicate knowledgeBaseId"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const attach = body.attach === true;

			// Attach mode: bind the KB to a pre-existing data-plane
			// collection. Validate up-front that the collection exists and
			// is dimension-compatible with the bound embedding service so
			// we never half-create a KB row pointing at the wrong
			// collection. Owned mode (default) provisions a fresh
			// collection after the row lands and rolls back on failure.
			if (attach) {
				if (!body.vectorCollection) {
					throw new ApiError(
						"vector_collection_required",
						"`vectorCollection` is required when `attach` is true",
						400,
					);
				}
				const workspace = await store.getWorkspace(workspaceId);
				if (!workspace) {
					throw new ControlPlaneNotFoundError("workspace", workspaceId);
				}
				const embedding = await store.getEmbeddingService(
					workspaceId,
					body.embeddingServiceId,
				);
				if (!embedding) {
					throw new ControlPlaneNotFoundError(
						"embedding service",
						body.embeddingServiceId,
					);
				}
				const driver = drivers.for(workspace);
				const adoptable = (await driver.listAdoptable?.(workspace)) ?? [];
				const target = adoptable.find(
					(col) => col.name === body.vectorCollection,
				);
				if (!target) {
					throw new ApiError(
						"collection_not_found",
						`collection '${body.vectorCollection}' was not found in the workspace's data plane`,
						404,
					);
				}
				if (target.vectorDimension !== embedding.embeddingDimension) {
					throw new DimensionMismatchError(
						embedding.embeddingDimension,
						target.vectorDimension,
					);
				}
				if (
					target.embedding &&
					(target.embedding.provider !== embedding.provider ||
						target.embedding.model !== embedding.modelName)
				) {
					throw new ApiError(
						"vectorize_service_mismatch",
						`collection's embedding service (${target.embedding.provider}:${target.embedding.model}) does not match the bound embedding service (${embedding.provider}:${embedding.modelName})`,
						400,
					);
				}
			}

			// 1. Persist the KB row. Throws on conflict / missing service refs.
			const record = await store.createKnowledgeBase(workspaceId, {
				...body,
				uid: body.knowledgeBaseId,
				owned: !attach,
			});

			// 2. Provision the underlying vector collection — owned only.
			//    On failure we roll back the KB row so the control plane
			//    and data plane don't drift. Attach mode skips this:
			//    the collection already exists and we don't touch it.
			if (!attach) {
				try {
					const { workspace, descriptor } = await resolveKb(
						store,
						workspaceId,
						record.knowledgeBaseId,
					);
					const driver = drivers.for(workspace);
					await driver.createCollection({ workspace, descriptor });
				} catch (err) {
					await store.deleteKnowledgeBase(workspaceId, record.knowledgeBaseId);
					throw err;
				}
			}
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/adoptable-collections",
			tags: ["knowledge-bases"],
			summary: "List adoptable data-plane collections",
			description:
				"Returns every collection in the workspace's data plane that has a vector configuration, with each collection's dimension, similarity, and (if any) `$vectorize` service. Used by the create-KB UI to offer attach-existing as an alternative to provisioning a fresh collection. `attached: true` flags collections already bound to a workbench KB.",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: AdoptableCollectionListSchema },
					},
					description: "Adoptable collections",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const workspace = await store.getWorkspace(workspaceId);
			if (!workspace) {
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			}
			const driver = drivers.for(workspace);
			const collections = (await driver.listAdoptable?.(workspace)) ?? [];
			const kbs = await store.listKnowledgeBases(workspaceId);
			const bound = new Set(
				kbs.map((kb) => kb.vectorCollection).filter((n): n is string => !!n),
			);
			return c.json(
				{
					items: collections.map((col) => ({
						name: col.name,
						vectorDimension: col.vectorDimension,
						vectorSimilarity: col.vectorSimilarity,
						vectorService: col.embedding
							? {
									provider: col.embedding.provider,
									modelName: col.embedding.model,
								}
							: null,
						lexicalEnabled: col.lexicalEnabled,
						rerankEnabled: col.rerankEnabled,
						attached: bound.has(col.name),
					})),
				},
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}",
			tags: ["knowledge-bases"],
			summary: "Get a knowledge base",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: KnowledgeBaseRecordSchema },
					},
					description: "Knowledge base",
				},
				...errorResponse(404, "Workspace or knowledge base not found"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getKnowledgeBase(workspaceId, knowledgeBaseId);
			if (!record)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}",
			tags: ["knowledge-bases"],
			summary: "Update a knowledge base",
			description:
				"`embeddingServiceId` and `chunkingServiceId` are immutable after creation — vectors and chunks on disk are bound to the model that produced them. The reranker, lexical config, language, name, description, and status can all be patched.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateKnowledgeBaseInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: KnowledgeBaseRecordSchema },
					},
					description: "Updated knowledge base",
				},
				...errorResponse(
					404,
					"Workspace, knowledge base, or reranking service not found",
				),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateKnowledgeBase(
				workspaceId,
				knowledgeBaseId,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}",
			tags: ["knowledge-bases"],
			summary: "Delete a knowledge base",
			description:
				"Drops the descriptor row only. The underlying vector collection cleanup lands when the data plane is rewired in a follow-up phase.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				...errorResponse(404, "Workspace or knowledge base not found"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);

			// Drop the underlying collection first when the runtime owns
			// it; if the driver call fails the KB row survives so the
			// operator can inspect. Attached KBs (owned: false) are
			// detached without touching the collection — it may be
			// referenced by other systems.
			const existing = await store.getKnowledgeBase(
				workspaceId,
				knowledgeBaseId,
			);
			if (!existing) {
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			}
			if (existing.owned) {
				const { workspace, descriptor } = await resolveKb(
					store,
					workspaceId,
					knowledgeBaseId,
				);
				const driver = drivers.for(workspace);
				await driver.dropCollection({ workspace, descriptor });
			}

			const { deleted } = await store.deleteKnowledgeBase(
				workspaceId,
				knowledgeBaseId,
			);
			if (!deleted)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			return c.body(null, 204);
		},
	);

	return app;
}
