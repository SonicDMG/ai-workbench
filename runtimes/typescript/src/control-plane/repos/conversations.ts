/**
 * Conversation aggregate (agent-scoped). Backs the
 * `/agents/{a}/conversations[/{c}/messages]` surface; messages live
 * in a sibling repo partitioned by (workspace, conversation).
 */

import type { ConversationRecord } from "../types.js";

/**
 * Input for {@link ConversationRepo.createConversation}.
 *
 * `knowledgeBaseIds` is the per-conversation RAG-grounding set.
 * Empty / omitted = the conversation draws from all KBs in the
 * workspace at retrieval time. Populated = restricted to those KBs
 * (must exist; the store does **not** validate KB existence here —
 * the route layer does, so deleted KBs eventually disappear from the
 * set via the KB cascade).
 */
export interface CreateConversationInput {
	readonly conversationId?: string;
	readonly title?: string | null;
	readonly knowledgeBaseIds?: readonly string[];
}

export interface UpdateConversationInput {
	readonly title?: string | null;
	readonly knowledgeBaseIds?: readonly string[];
}

export interface ConversationRepo {
	listConversations(
		workspaceId: string,
		agentId: string,
	): Promise<readonly ConversationRecord[]>;
	getConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<ConversationRecord | null>;
	createConversation(
		workspaceId: string,
		agentId: string,
		input: CreateConversationInput,
	): Promise<ConversationRecord>;
	updateConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
		patch: UpdateConversationInput,
	): Promise<ConversationRecord>;
	deleteConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<{ deleted: boolean }>;
}
