/**
 * Chat-message aggregate (conversation-scoped). Agent-agnostic from
 * the storage POV — messages are partitioned by (workspace,
 * conversation), not by agent — so the agent doesn't appear in
 * these signatures. The legacy method names (`*ChatMessage*`) are
 * retained for Phase C; a follow-up pass will rename them to
 * `*ConversationMessage*`.
 */

import type { AgentRole, MessageRecord } from "../types.js";

/**
 * Input for {@link ChatMessageRepo.appendChatMessage}. `messageTs`
 * is server-stamped if omitted — callers should generally let the
 * store stamp it so chronological cluster ordering is monotonic.
 *
 * `metadata` is a free-form string map; it carries RAG provenance
 * (`context_document_ids`), HF model, finish reason, and any error
 * detail for streaming finalization. Stringly-typed for v0.
 */
export interface AppendChatMessageInput {
	readonly messageId?: string;
	readonly messageTs?: string;
	readonly role: AgentRole;
	readonly authorId?: string | null;
	readonly content?: string | null;
	readonly toolId?: string | null;
	readonly toolCallPayload?: Readonly<Record<string, unknown>> | null;
	readonly toolResponse?: Readonly<Record<string, unknown>> | null;
	readonly tokenCount?: number | null;
	readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Patch a previously-appended message. The streaming flow inserts an
 * empty assistant placeholder at stream start, then patches `content`
 * + `metadata` (finish reason etc.) when the stream completes.
 *
 * `metadata` is **merged** key-by-key into the existing map (not
 * replaced) so callers can update individual provenance fields
 * without re-sending everything. Pass an explicit `undefined` value
 * to drop a key. `null` patch fields clear the corresponding column.
 */
export interface UpdateChatMessageInput {
	readonly content?: string | null;
	readonly tokenCount?: number | null;
	readonly metadata?: Readonly<Record<string, string | undefined>>;
}

export interface ChatMessageRepo {
	/**
	 * Chronologically-ordered message history for a conversation.
	 * Returns messages oldest-first (matching the underlying table's
	 * `message_ts ASC` cluster key); the UI flips for display.
	 */
	listChatMessages(
		workspaceId: string,
		conversationId: string,
	): Promise<readonly MessageRecord[]>;

	/**
	 * Append a turn. Throws `ControlPlaneNotFoundError` if the
	 * conversation doesn't exist. Stamps `messageId` (random UUID)
	 * and `messageTs` (now) when omitted.
	 */
	appendChatMessage(
		workspaceId: string,
		conversationId: string,
		input: AppendChatMessageInput,
	): Promise<MessageRecord>;

	/**
	 * Patch a previously-appended message. Used by the streaming flow
	 * to finalize an assistant placeholder once the model emits a
	 * terminal event. Throws `ControlPlaneNotFoundError` if the
	 * message isn't found.
	 */
	updateChatMessage(
		workspaceId: string,
		conversationId: string,
		messageId: string,
		patch: UpdateChatMessageInput,
	): Promise<MessageRecord>;
}
