/**
 * `/api/v1/workspaces/{workspaceId}/knowledge-bases` — Knowledge-Base
 * CRUD (issue #98).
 *
 * Replaces the retired `/catalogs/*` / `/vector-stores/*` model.
 * This file owns the HTTP surface (validation, status codes, OpenAPI
 * shape); the multi-step orchestration (collection
 * provision/rollback, attach validation, delete-with-collection-drop)
 * lives on `KnowledgeBaseService`.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import { audit } from "../../lib/audit.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	AdoptableCollectionListSchema,
	CreateKnowledgeBaseInputSchema,
	KnowledgeBaseCreateResponseSchema,
	KnowledgeBaseIdParamSchema,
	KnowledgeBasePageSchema,
	KnowledgeBaseRecordSchema,
	PaginationQuerySchema,
	UpdateKnowledgeBaseInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { createKnowledgeBaseService } from "../../services/knowledge-base-service.js";

export interface KnowledgeBaseRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
}

export function knowledgeBaseRoutes(
	deps: KnowledgeBaseRouteDeps,
): OpenAPIHono<AppEnv> {
	const { store } = deps;
	const service = createKnowledgeBaseService(deps);
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
				"Creates a KB bound to existing chunking + embedding (and optional reranking) services. Owned KBs auto-provision a vector collection named after the KB `name`; attach mode binds to an existing `vectorCollection` instead.",
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
						"application/json": { schema: KnowledgeBaseCreateResponseSchema },
					},
					description:
						"Knowledge base created. `astraQueries` carries any Data API calls the runtime made on the user's behalf — one `create_collection` snapshot for owned KBs on Astra workspaces, empty array for attach mode and non-Astra workspaces.",
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
			const body = c.req.valid("json");
			const { record, astraQueries } = await service.create(workspaceId, body);
			audit(c, {
				action: "kb.create",
				outcome: "success",
				workspaceId,
				details: {
					knowledgeBaseId: record.knowledgeBaseId,
					label: record.name,
				},
			});
			// Flat envelope — `astraQueries` is a sibling field on the
			// record so existing clients that ignore it keep working
			// (the field defaults to `[]` for non-Astra / attach paths).
			return c.json({ ...record, astraQueries: [...astraQueries] }, 201);
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
			const items = await service.listAdoptable(workspaceId);
			return c.json({ items }, 200);
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
				"`name`, `embeddingServiceId`, and `chunkingServiceId` are immutable after creation — the name doubles as the collection identifier, and vectors/chunks on disk are bound to the services that produced them. The reranker, lexical config, language, description, and status can all be patched.",
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
				"Drops the underlying vector collection first when this runtime owns it, then deletes the KB row and cascades document metadata. Attached KBs (`owned: false`) detach without touching the external collection.",
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
			await service.delete(workspaceId, knowledgeBaseId);
			audit(c, {
				action: "kb.delete",
				outcome: "success",
				workspaceId,
				details: { knowledgeBaseId },
			});
			return c.body(null, 204);
		},
	);

	return app;
}
