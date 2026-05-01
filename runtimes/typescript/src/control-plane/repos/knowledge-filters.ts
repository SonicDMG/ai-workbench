/**
 * Knowledge-filter aggregate (issue #98). Saved metadata-filter
 * presets scoped under a parent knowledge base; cleared by the KB
 * cascade.
 */

import type { KnowledgeFilterRecord } from "../types.js";

export interface CreateKnowledgeFilterInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly filter: Readonly<Record<string, unknown>>;
}

export type UpdateKnowledgeFilterInput = Partial<
	Omit<CreateKnowledgeFilterInput, "uid">
>;

export interface KnowledgeFilterRepo {
	listKnowledgeFilters(
		workspace: string,
		knowledgeBase: string,
	): Promise<readonly KnowledgeFilterRecord[]>;
	getKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<KnowledgeFilterRecord | null>;
	createKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		input: CreateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord>;
	updateKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
		patch: UpdateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord>;
	deleteKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<{ deleted: boolean }>;
}
