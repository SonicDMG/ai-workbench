/**
 * Resolve a Knowledge Base into a `VectorStoreRecord`-shaped descriptor
 * the existing driver / dispatch / ingest layer can consume unchanged.
 *
 * The new schema separates a KB (logical entity) from its bound
 * embedding service (network executor). The data-plane code, however,
 * was written against `VectorStoreRecord`, which carries the embedding
 * config inline. Rather than rewrite every driver and the search /
 * upsert dispatch surface in one go, we materialise a descriptor on
 * the fly: KB.vector_collection becomes the descriptor name, KB.lexical
 * passes through, and the bound embedding / reranking services get
 * folded back into the descriptor's nested config blocks.
 *
 * Readers should treat the returned object as opaque — it's a wire
 * shape for drivers, not a record callers should display.
 */

import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type {
	KnowledgeBaseRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../control-plane/types.js";

export interface KbResolution {
	readonly workspace: WorkspaceRecord;
	readonly knowledgeBase: KnowledgeBaseRecord;
	readonly descriptor: VectorStoreRecord;
}

/**
 * Look up a workspace + KB and synthesise the legacy descriptor shape.
 * Throws `ControlPlaneNotFoundError` for any missing parent — the
 * route layer's error mapper turns those into the canonical 404
 * envelope.
 */
export async function resolveKb(
	store: ControlPlaneStore,
	workspaceUid: string,
	knowledgeBaseUid: string,
): Promise<KbResolution> {
	const workspace = await store.getWorkspace(workspaceUid);
	if (!workspace) {
		throw new ControlPlaneNotFoundError("workspace", workspaceUid);
	}

	const knowledgeBase = await store.getKnowledgeBase(
		workspaceUid,
		knowledgeBaseUid,
	);
	if (!knowledgeBase) {
		throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseUid);
	}

	const embedding = await store.getEmbeddingService(
		workspaceUid,
		knowledgeBase.embeddingServiceId,
	);
	if (!embedding) {
		throw new ControlPlaneNotFoundError(
			"embedding service",
			knowledgeBase.embeddingServiceId,
		);
	}

	const reranking = knowledgeBase.rerankingServiceId
		? await store.getRerankingService(
				workspaceUid,
				knowledgeBase.rerankingServiceId,
			)
		: null;

	const descriptor: VectorStoreRecord = {
		workspace: workspaceUid,
		uid: knowledgeBase.knowledgeBaseId,
		// The data plane addresses the underlying collection by name.
		// `vector_collection` is the auto-provisioned name set on KB
		// create; falling back to `wb_vectors_<id>` keeps older rows
		// (created before the column landed) usable.
		name: knowledgeBase.vectorCollection ?? knowledgeBase.knowledgeBaseId,
		vectorDimension: embedding.embeddingDimension,
		vectorSimilarity:
			embedding.distanceMetric === "dot"
				? "dot"
				: embedding.distanceMetric === "euclidean"
					? "euclidean"
					: "cosine",
		embedding: {
			provider: embedding.provider,
			model: embedding.modelName,
			endpoint:
				joinUrl(embedding.endpointBaseUrl, embedding.endpointPath) ?? null,
			dimension: embedding.embeddingDimension,
			secretRef: embedding.credentialRef,
		},
		lexical: knowledgeBase.lexical,
		reranking: reranking
			? {
					enabled: true,
					provider: reranking.provider,
					model: reranking.modelName,
					endpoint:
						joinUrl(reranking.endpointBaseUrl, reranking.endpointPath) ?? null,
					secretRef: reranking.credentialRef,
				}
			: {
					enabled: false,
					provider: null,
					model: null,
					endpoint: null,
					secretRef: null,
				},
		createdAt: knowledgeBase.createdAt,
		updatedAt: knowledgeBase.updatedAt,
	};

	return { workspace, knowledgeBase, descriptor };
}

function joinUrl(base: string | null, path: string | null): string | null {
	if (!base) return null;
	if (!path) return base;
	if (base.endsWith("/") && path.startsWith("/")) {
		return base + path.slice(1);
	}
	if (!base.endsWith("/") && !path.startsWith("/")) {
		return `${base}/${path}`;
	}
	return base + path;
}
