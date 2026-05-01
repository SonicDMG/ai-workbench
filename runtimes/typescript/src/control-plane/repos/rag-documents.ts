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
