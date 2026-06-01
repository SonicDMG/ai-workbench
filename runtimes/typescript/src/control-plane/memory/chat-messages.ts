/**
 * Chat-message aggregate slice. Owns the
 * `Map<${workspaceId}:${conversationId}, Map<messageId, MessageRecord>>`
 * partition. Messages are partitioned by (workspace, conversation),
 * not by agent — the helpers here resolve a conversation across any
 * agent in the workspace.
 */

import { randomUUID } from "node:crypto";
import {
	type KeysetPage,
	type ListPageOptions,
	paginateKeyset,
} from "../../lib/pagination.js";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import {
	byMessageTsAsc,
	freezeMetadata,
	MESSAGE_PAGE_DIRECTION,
	mergeMetadata,
	messageKeysetKey,
	recentMessagesTail,
} from "../shared/records.js";
import type {
	AppendChatMessageInput,
	ChatMessageRepo,
	UpdateChatMessageInput,
} from "../store.js";
import type { MessageRecord } from "../types.js";
import { assertChat, type MemoryStoreState } from "./state.js";

export function makeChatMessageMethods(
	state: MemoryStoreState,
): ChatMessageRepo {
	return {
		async listChatMessages(
			workspaceId: string,
			chatId: string,
		): Promise<readonly MessageRecord[]> {
			await assertChat(state, workspaceId, chatId);
			const byMsg = state.messages.get(`${workspaceId}:${chatId}`);
			if (!byMsg) return [];
			// Oldest-first matches the underlying `message_ts ASC` cluster
			// key. UI flips for display.
			return Array.from(byMsg.values()).sort(byMessageTsAsc);
		},

		async listRecentChatMessages(
			workspaceId: string,
			chatId: string,
			limit: number,
		): Promise<readonly MessageRecord[]> {
			await assertChat(state, workspaceId, chatId);
			const byMsg = state.messages.get(`${workspaceId}:${chatId}`);
			if (!byMsg) return [];
			return recentMessagesTail(Array.from(byMsg.values()), limit);
		},

		async listChatMessagesPage(
			workspaceId: string,
			chatId: string,
			opts: ListPageOptions,
		): Promise<KeysetPage<MessageRecord>> {
			await assertChat(state, workspaceId, chatId);
			const byMsg = state.messages.get(`${workspaceId}:${chatId}`);
			return paginateKeyset(byMsg ? Array.from(byMsg.values()) : [], {
				after: opts.after,
				limit: opts.limit,
				direction: MESSAGE_PAGE_DIRECTION,
				keyOf: messageKeysetKey,
			});
		},

		async appendChatMessage(
			workspaceId: string,
			chatId: string,
			input: AppendChatMessageInput,
		): Promise<MessageRecord> {
			await assertChat(state, workspaceId, chatId);
			const messageId = input.messageId ?? randomUUID();
			const key = `${workspaceId}:${chatId}`;
			const byMsg = state.messages.get(key) ?? new Map();
			if (byMsg.has(messageId)) {
				throw new ControlPlaneConflictError(
					`message with id '${messageId}' already exists`,
				);
			}
			const record: MessageRecord = {
				workspaceId,
				conversationId: chatId,
				messageTs: input.messageTs ?? nowIso(),
				messageId,
				role: input.role,
				authorId: input.authorId ?? null,
				content: input.content ?? null,
				toolId: input.toolId ?? null,
				toolCallPayload: input.toolCallPayload
					? Object.freeze({ ...input.toolCallPayload })
					: null,
				toolResponse: input.toolResponse
					? Object.freeze({ ...input.toolResponse })
					: null,
				tokenCount: input.tokenCount ?? null,
				metadata: freezeMetadata(input.metadata),
			};
			byMsg.set(messageId, record);
			state.messages.set(key, byMsg);
			return record;
		},

		async updateChatMessage(
			workspaceId: string,
			chatId: string,
			messageId: string,
			patch: UpdateChatMessageInput,
		): Promise<MessageRecord> {
			await assertChat(state, workspaceId, chatId);
			const byMsg = state.messages.get(`${workspaceId}:${chatId}`);
			const existing = byMsg?.get(messageId);
			if (!existing) {
				throw new ControlPlaneNotFoundError("chat message", messageId);
			}
			const next: MessageRecord = {
				...existing,
				...(patch.content !== undefined && { content: patch.content }),
				...(patch.tokenCount !== undefined && { tokenCount: patch.tokenCount }),
				...(patch.metadata !== undefined && {
					metadata: mergeMetadata(existing.metadata, patch.metadata),
				}),
			};
			byMsg?.set(messageId, next);
			return next;
		},
	};
}
