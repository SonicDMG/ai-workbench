/**
 * Knowledge-base aggregate (issue #98). KBs reference embedding /
 * chunking / reranking services in the same workspace; create-time
 * validation lives in the implementation.
 */

import type {
	KnowledgeBaseLanguage,
	KnowledgeBaseRecord,
	KnowledgeBaseStatus,
	LexicalConfig,
} from "../types.js";

export interface CreateKnowledgeBaseInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly status?: KnowledgeBaseStatus;
	readonly embeddingServiceId: string;
	readonly chunkingServiceId: string;
	readonly rerankingServiceId?: string | null;
	readonly language?: KnowledgeBaseLanguage | null;
	readonly lexical?: LexicalConfig;
	/** Optional override for the auto-provisioned vector collection name.
	 * If omitted the store generates `wb_vectors_<knowledge_base_id>`. */
	readonly vectorCollection?: string | null;
	/** When `false`, the runtime did NOT provision the underlying
	 * collection (KB was attached to a pre-existing one) and `DELETE`
	 * must NOT drop it. Defaults to `true` for backward compatibility. */
	readonly owned?: boolean;
}

/**
 * Patch a Knowledge Base. `embeddingServiceId` and `chunkingServiceId`
 * are intentionally absent — they're immutable after creation because
 * existing vectors / chunks on disk are bound to the model that
 * produced them. Re-embedding is a separate operation.
 */
export interface UpdateKnowledgeBaseInput {
	readonly name?: string;
	readonly description?: string | null;
	readonly status?: KnowledgeBaseStatus;
	readonly rerankingServiceId?: string | null;
	readonly language?: KnowledgeBaseLanguage | null;
	readonly lexical?: LexicalConfig;
}

export interface KnowledgeBaseRepo {
	listKnowledgeBases(
		workspace: string,
	): Promise<readonly KnowledgeBaseRecord[]>;
	getKnowledgeBase(
		workspace: string,
		uid: string,
	): Promise<KnowledgeBaseRecord | null>;
	/**
	 * Create a knowledge base record. Does NOT provision the underlying
	 * vector collection — that's the route layer's job (it uses the
	 * driver registry so the same call works on every backend). The
	 * returned record carries the auto-assigned `vectorCollection`
	 * name; the route then asks the driver to materialize a collection
	 * with that name and dimension.
	 *
	 * Validates that the bound `embeddingServiceId` /
	 * `chunkingServiceId` / optional `rerankingServiceId` exist in the
	 * same workspace; throws `ControlPlaneNotFoundError` if any are
	 * missing.
	 */
	createKnowledgeBase(
		workspace: string,
		input: CreateKnowledgeBaseInput,
	): Promise<KnowledgeBaseRecord>;
	updateKnowledgeBase(
		workspace: string,
		uid: string,
		patch: UpdateKnowledgeBaseInput,
	): Promise<KnowledgeBaseRecord>;
	/**
	 * Delete the KB row + cascade through RAG documents and knowledge
	 * filters. Does NOT drop the underlying vector collection — the
	 * route layer drops the collection BEFORE this call so a partial
	 * failure leaves the KB intact, not orphaned-with-no-collection.
	 */
	deleteKnowledgeBase(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;
}
