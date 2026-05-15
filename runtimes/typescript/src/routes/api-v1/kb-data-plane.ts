/**
 * `/api/v1/workspaces/{workspaceId}/knowledge-bases/{knowledgeBaseId}/...`
 * data-plane endpoints (issue #98).
 *
 *   POST   .../records              upsert vectors
 *   DELETE .../records/{recordId}   delete a record
 *   POST   .../search               vector / hybrid / rerank search
 *
 * Internally these resolve the KB into a `VectorStoreRecord`-shaped
 * descriptor (see {@link ./kb-descriptor}) and forward to the existing
 * driver / dispatch layer. The KB's `vector_collection` is the
 * collection name the driver addresses; the bound embedding service
 * supplies the dimension and provider config.
 *
 * This is the canonical data-plane surface. The older
 * `/vector-stores/{vs}/...` routes were folded into the KB model so
 * callers always address the logical knowledge base.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { getRequestPrincipal } from "../../auth/principal-resolver.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { ApiError } from "../../lib/errors.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import type { AppEnv } from "../../lib/types.js";
import {
	DeleteRecordResponseSchema,
	KnowledgeBaseIdParamSchema,
	RecordIdParamSchema,
	SearchHitSchema,
	SearchRequestSchema,
	UpsertRequestSchema,
	UpsertResponseSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import {
	buildPolicyContext,
	PolicyDeniedError,
} from "../../policy/enforcer.js";
import { resolveKb } from "./kb-descriptor.js";
import { dispatchSearch, toMutableHits } from "./search-dispatch.js";
import { dispatchUpsert } from "./upsert-dispatch.js";

export interface KbDataPlaneDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
}

export function kbDataPlaneRoutes(deps: KbDataPlaneDeps): OpenAPIHono<AppEnv> {
	const { store, drivers, embedders } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/records",
			tags: ["knowledge-bases"],
			summary: "Upsert vector records into a knowledge base",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
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
				...errorResponse(
					404,
					"Workspace, knowledge base, or embedding service not found",
				),
				...errorResponse(400, "Dimension mismatch or malformed request"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			const body = c.req.valid("json");
			const { workspace, descriptor } = await resolveKb(
				store,
				workspaceId,
				knowledgeBaseId,
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
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/records/{recordId}",
			tags: ["knowledge-bases"],
			summary: "Delete a vector record from a knowledge base",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
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
				...errorResponse(404, "Workspace or knowledge base not found"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, recordId } = c.req.valid("param");
			const { workspace, descriptor } = await resolveKb(
				store,
				workspaceId,
				knowledgeBaseId,
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
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/search",
			tags: ["knowledge-bases"],
			summary: "Search the knowledge base (vector / hybrid / rerank)",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
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
				...errorResponse(404, "Workspace or knowledge base not found"),
				...errorResponse(400, "Dimension mismatch or malformed request"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			const body = c.req.valid("json");
			const { workspace, descriptor } = await resolveKb(
				store,
				workspaceId,
				knowledgeBaseId,
			);
			// RLAC: merge the KB's compiled policy filter into the search
			// `filter` parameter. Stefano's design: Data API combines the
			// merged filter with the vector sort server-side, so the
			// filter doesn't degrade recall — the post-filter recall
			// problem doesn't exist for this surface. See
			// `docs/rlac-prototype/data-api-design-ask.md`.
			const kb = await store.getKnowledgeBase(workspaceId, knowledgeBaseId);
			if (!kb)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			const ws = await store.getWorkspace(workspaceId);
			let mergedBody = body;
			try {
				const decision = await buildPolicyContext({
					workspace: workspaceId,
					workspaceRlacEnabled: ws?.rlacEnabled ?? false,
					knowledgeBase: kb,
					principal: getRequestPrincipal(c),
					action: "search",
					resourceId: "*",
					audit: store,
				});
				if (decision.filter) {
					mergedBody = {
						...body,
						filter: mergeFilter(body.filter, decision.filter),
					};
				}
			} catch (err) {
				if (err instanceof PolicyDeniedError) {
					throw new ApiError("policy_principal_required", err.reason, 401);
				}
				throw err;
			}
			const driver = drivers.for(workspace);
			const ctx = { workspace, descriptor };
			const hits = await dispatchSearch({
				ctx,
				driver,
				body: mergedBody,
				embedders,
			});
			return c.json(toMutableHits(hits), 200);
		},
	);

	return app;
}

/**
 * Merge two Data API filter clauses with `$and`. Either side may be
 * undefined; an `$and` of a single clause collapses to that clause to
 * keep the wire shape clean.
 */
function mergeFilter(
	caller: Readonly<Record<string, unknown>> | undefined,
	policy: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	if (!caller || Object.keys(caller).length === 0) return policy;
	return { $and: [caller, policy] };
}
