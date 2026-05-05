/**
 * RAG document aggregate (KB-scoped — issue #98). Documents live under
 * `wb_rag_documents_by_knowledge_base`; cascade rules for parent
 * deletion live in `../cascade.ts`.
 */

import type { DocumentStatus, RagDocumentRecord } from "../types.js";

export interface CreateRagDocumentInput {
	readonly uid?: string;
	readonly sourceDocId?: string | null;
	readonly sourceFilename?: string | null;
	readonly fileType?: string | null;
	readonly fileSize?: number | null;
	readonly contentHash?: string | null;
	readonly chunkTotal?: number | null;
	readonly ingestedAt?: string | null;
	readonly status?: DocumentStatus;
	readonly errorMessage?: string | null;
	readonly metadata?: Readonly<Record<string, string>>;
}

export type UpdateRagDocumentInput = Partial<
	Omit<CreateRagDocumentInput, "uid">
>;

export interface RagDocumentRepo {
	listRagDocuments(
		workspace: string,
		knowledgeBase: string,
	): Promise<readonly RagDocumentRecord[]>;
	getRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<RagDocumentRecord | null>;
	/**
	 * Look up an existing document by its content hash within a KB.
	 * Returns `null` if no document with that hash exists. Used by the
	 * ingest service to short-circuit re-ingestion of byte-identical
	 * content (the hash is SHA-256 of the input text). Returns the
	 * first match if multiple exist (which shouldn't happen for a
	 * post-dedup-launch document set, but is tolerated for backfill).
	 */
	findRagDocumentByContentHash(
		workspace: string,
		knowledgeBase: string,
		contentHash: string,
	): Promise<RagDocumentRecord | null>;
	/**
	 * Look up an existing document by its `sourceFilename` within a KB.
	 * Returns `null` if no document with that filename exists. Used by
	 * the ingest service to detect name collisions: when the user
	 * uploads a file whose name already exists in the KB but whose
	 * content hash differs, the service prompts the client to confirm
	 * an overwrite. Filenames are not unique by construction (the same
	 * doc can be re-ingested with `overwriteOnNameConflict: true` and
	 * the old row is dropped first), so this returns the first match.
	 */
	findRagDocumentBySourceFilename(
		workspace: string,
		knowledgeBase: string,
		sourceFilename: string,
	): Promise<RagDocumentRecord | null>;
	createRagDocument(
		workspace: string,
		knowledgeBase: string,
		input: CreateRagDocumentInput,
	): Promise<RagDocumentRecord>;
	updateRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
		patch: UpdateRagDocumentInput,
	): Promise<RagDocumentRecord>;
	deleteRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<{ deleted: boolean }>;
}
