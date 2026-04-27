/**
 * `/api/v1/workspaces/{workspaceUid}/knowledge-bases` — Knowledge-Base
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
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateKnowledgeBaseInputSchema,
	ErrorEnvelopeSchema,
	KnowledgeBasePageSchema,
	KnowledgeBaseRecordSchema,
	KnowledgeBaseUidParamSchema,
	PaginationQuerySchema,
	UpdateKnowledgeBaseInputSchema,
	WorkspaceUidParamSchema,
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
			path: "/{workspaceUid}/knowledge-bases",
			tags: ["knowledge-bases"],
			summary: "List knowledge bases in a workspace",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: KnowledgeBasePageSchema },
					},
					description: "All knowledge bases in the workspace",
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
			const rows = await store.listKnowledgeBases(workspaceUid);
			return c.json(paginate(rows, query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/knowledge-bases",
			tags: ["knowledge-bases"],
			summary: "Create a knowledge base in a workspace",
			description:
				"Creates a KB bound to existing chunking + embedding (and optional reranking) services. The vector collection is auto-provisioned from the embedding service's dimension and distance metric, named `wb_vectors_<kb_id>` unless overridden.",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
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
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"Workspace, embedding service, chunking service, or reranking service not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate uid",
				},
			},
		}),
		async (c) => {
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");

			// 1. Persist the KB row. Throws on conflict / missing service refs.
			const record = await store.createKnowledgeBase(workspaceUid, body);

			// 2. Provision the underlying vector collection. The driver
			//    needs the descriptor shape, so we synthesise one — same
			//    helper the data plane uses. On failure we roll back the
			//    KB row so the control plane and data plane don't drift.
			try {
				const { workspace, descriptor } = await resolveKb(
					store,
					workspaceUid,
					record.knowledgeBaseId,
				);
				const driver = drivers.for(workspace);
				await driver.createCollection({ workspace, descriptor });
			} catch (err) {
				await store.deleteKnowledgeBase(workspaceUid, record.knowledgeBaseId);
				throw err;
			}
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/knowledge-bases/{knowledgeBaseUid}",
			tags: ["knowledge-bases"],
			summary: "Get a knowledge base",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					knowledgeBaseUid: KnowledgeBaseUidParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: KnowledgeBaseRecordSchema },
					},
					description: "Knowledge base",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or knowledge base not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, knowledgeBaseUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const record = await store.getKnowledgeBase(
				workspaceUid,
				knowledgeBaseUid,
			);
			if (!record)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseUid);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceUid}/knowledge-bases/{knowledgeBaseUid}",
			tags: ["knowledge-bases"],
			summary: "Update a knowledge base",
			description:
				"`embeddingServiceId` and `chunkingServiceId` are immutable after creation — vectors and chunks on disk are bound to the model that produced them. The reranker, lexical config, language, name, description, and status can all be patched.",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					knowledgeBaseUid: KnowledgeBaseUidParamSchema,
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
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"Workspace, knowledge base, or reranking service not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, knowledgeBaseUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.updateKnowledgeBase(
				workspaceUid,
				knowledgeBaseUid,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}/knowledge-bases/{knowledgeBaseUid}",
			tags: ["knowledge-bases"],
			summary: "Delete a knowledge base",
			description:
				"Drops the descriptor row only. The underlying vector collection cleanup lands when the data plane is rewired in a follow-up phase.",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					knowledgeBaseUid: KnowledgeBaseUidParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or knowledge base not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, knowledgeBaseUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);

			// Drop the underlying collection first; if the driver call
			// fails the KB row survives so the operator can inspect.
			// Mirrors the legacy /vector-stores delete semantics.
			const existing = await store.getKnowledgeBase(
				workspaceUid,
				knowledgeBaseUid,
			);
			if (!existing) {
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseUid);
			}
			const { workspace, descriptor } = await resolveKb(
				store,
				workspaceUid,
				knowledgeBaseUid,
			);
			const driver = drivers.for(workspace);
			await driver.dropCollection({ workspace, descriptor });

			const { deleted } = await store.deleteKnowledgeBase(
				workspaceUid,
				knowledgeBaseUid,
			);
			if (!deleted)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseUid);
			return c.body(null, 204);
		},
	);

	return app;
}
