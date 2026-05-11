/**
 * Chat-message aggregate slice for the file-backed store. Messages
 * are partitioned by (workspace, conversation) — the slice resolves
 * chats workspace-wide through {@link assertChat}.
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import {
	byMessageTsAsc,
	mergeMetadata as mergeMessageMetadata,
} from "../shared/records.js";
import type {
	AppendChatMessageInput,
	ChatMessageRepo,
	UpdateChatMessageInput,
} from "../store.js";
import type { MessageRecord } from "../types.js";
import { assertChat, type FileStoreState } from "./state.js";

export function makeChatMessageMethods(state: FileStoreState): ChatMessageRepo {
	return {
		async listChatMessages(
			workspaceId: string,
			chatId: string,
		): Promise<readonly MessageRecord[]> {
			await assertChat(state, workspaceId, chatId);
			const all = await state.readAll("messages");
			return all
				.filter(
					(m) => m.workspaceId === workspaceId && m.conversationId === chatId,
				)
				.sort(byMessageTsAsc);
		},

		async appendChatMessage(
			workspaceId: string,
			chatId: string,
			input: AppendChatMessageInput,
		): Promise<MessageRecord> {
			await assertChat(state, workspaceId, chatId);
			return state.mutate("messages", (rows) => {
				const messageId = input.messageId ?? randomUUID();
				if (
					rows.some(
						(m) =>
							m.workspaceId === workspaceId &&
							m.conversationId === chatId &&
							m.messageId === messageId,
					)
				) {
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
					metadata: Object.freeze({ ...(input.metadata ?? {}) }),
				};
				return { rows: [...rows, record], result: record };
			});
		},

		async updateChatMessage(
			workspaceId: string,
			chatId: string,
			messageId: string,
			patch: UpdateChatMessageInput,
		): Promise<MessageRecord> {
			await assertChat(state, workspaceId, chatId);
			return state.mutate("messages", (rows) => {
				const idx = rows.findIndex(
					(m) =>
						m.workspaceId === workspaceId &&
						m.conversationId === chatId &&
						m.messageId === messageId,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("chat message", messageId);
				}
				const existing = rows[idx] as MessageRecord;
				const next: MessageRecord = {
					...existing,
					...(patch.content !== undefined && { content: patch.content }),
					...(patch.tokenCount !== undefined && {
						tokenCount: patch.tokenCount,
					}),
					...(patch.metadata !== undefined && {
						metadata: mergeMessageMetadata(existing.metadata, patch.metadata),
					}),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},
	};
}
