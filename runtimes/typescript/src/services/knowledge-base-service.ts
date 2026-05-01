/**
 * Domain orchestration for Knowledge-Base lifecycle.
 *
 * Owns the multi-step flows that need to keep the control plane and
 * data plane in sync — KB-create-with-collection-rollback,
 * KB-delete-with-collection-drop, and the attach-existing validation
 * dance. Routes call into this service and stay in the
 * validate-and-delegate band; the service is the only place these
 * sequences live so Python/Java green-box parity has a clear porting
 * target.
 */

import type { z } from "@hono/zod-openapi";
import { ControlPlaneNotFoundError } from "../control-plane/errors.js";
import type {
	EmbeddingServiceRepo,
	KnowledgeBaseRepo,
	RerankingServiceRepo,
	WorkspaceRepo,
} from "../control-plane/store.js";
import type { KnowledgeBaseRecord } from "../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import { DimensionMismatchError } from "../drivers/vector-store.js";
import { ApiError } from "../lib/errors.js";
import type { CreateKnowledgeBaseInputSchema } from "../openapi/schemas.js";
import { resolveKb } from "../routes/api-v1/kb-descriptor.js";

export type CreateKnowledgeBaseRequest = z.infer<
	typeof CreateKnowledgeBaseInputSchema
>;

/**
 * Adoptable-collection projection the UI consumes for the
 * attach-existing flow. `attached` is true when a workbench KB already
 * binds the collection — the UI greys those out.
 */
export interface AdoptableCollection {
	readonly name: string;
	readonly vectorDimension: number;
	readonly vectorSimilarity: "cosine" | "dot" | "euclidean";
	readonly vectorService: {
		readonly provider: string;
		readonly modelName: string;
	} | null;
	readonly lexicalEnabled: boolean;
	readonly rerankEnabled: boolean;
	readonly attached: boolean;
}

/**
 * Repo intersection KnowledgeBaseService needs. The monolithic
 * `ControlPlaneStore` satisfies it, so callers pass that today; this
 * narrower shape documents the actual surface area and keeps
 * Python/Java green-box ports honest about which aggregates the
 * service touches.
 */
export type KnowledgeBaseServiceStore = WorkspaceRepo &
	KnowledgeBaseRepo &
	EmbeddingServiceRepo &
	Pick<RerankingServiceRepo, "getRerankingService">;

export interface KnowledgeBaseServiceDeps {
	readonly store: KnowledgeBaseServiceStore;
	readonly drivers: VectorStoreDriverRegistry;
}

export interface KnowledgeBaseService {
	listAdoptable(workspaceId: string): Promise<AdoptableCollection[]>;
	create(
		workspaceId: string,
		input: CreateKnowledgeBaseRequest,
	): Promise<KnowledgeBaseRecord>;
	delete(workspaceId: string, knowledgeBaseId: string): Promise<void>;
}

export function createKnowledgeBaseService(
	deps: KnowledgeBaseServiceDeps,
): KnowledgeBaseService {
	const { store, drivers } = deps;

	return {
		async listAdoptable(workspaceId) {
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
			return collections.map((col) => ({
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
			}));
		},

		async create(workspaceId, input) {
			const attach = input.attach === true;

			// Attach mode: validate up-front that the collection exists and
			// is dimension-compatible with the bound embedding service so
			// we never half-create a KB row pointing at the wrong
			// collection. Owned mode (default) provisions a fresh
			// collection after the row lands and rolls back on failure.
			if (attach) {
				if (!input.vectorCollection) {
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
					input.embeddingServiceId,
				);
				if (!embedding) {
					throw new ControlPlaneNotFoundError(
						"embedding service",
						input.embeddingServiceId,
					);
				}
				const driver = drivers.for(workspace);
				const adoptable = (await driver.listAdoptable?.(workspace)) ?? [];
				const target = adoptable.find(
					(col) => col.name === input.vectorCollection,
				);
				if (!target) {
					throw new ApiError(
						"collection_not_found",
						`collection '${input.vectorCollection}' was not found in the workspace's data plane`,
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

			const record = await store.createKnowledgeBase(workspaceId, {
				...input,
				uid: input.knowledgeBaseId,
				owned: !attach,
			});

			// Provision the underlying vector collection — owned only.
			// On failure roll back the KB row so the control plane
			// and data plane don't drift. Attach mode skips this:
			// the collection already exists and we don't touch it.
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
			return record;
		},

		async delete(workspaceId, knowledgeBaseId) {
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
			if (!deleted) {
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			}
		},
	};
}
