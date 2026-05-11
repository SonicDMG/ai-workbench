/**
 * Chat-message aggregate slice for the Astra-backed store. Owns
 * `wb_messages`. Messages are partitioned by (workspace, conversation)
 * only — append / list / update don't need an agent argument. The
 * workspace-wide chat resolution happens via the `assertChat` helper
 * in `./state.ts`.
 */

import { randomUUID } from "node:crypto";
import { messageFromRow, messageToRow } from "../../astra-client/converters.js";
import { nowIso } from "../defaults.js";
import { ControlPlaneNotFoundError } from "../errors.js";
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
import { type AstraStoreState, assertChat } from "./state.js";

export function makeChatMessageMethods(
	state: AstraStoreState,
): ChatMessageRepo {
	return {
		async listChatMessages(
			workspaceId: string,
			chatId: string,
		): Promise<readonly MessageRecord[]> {
			await assertChat(state, workspaceId, chatId);
			const rows = await state.tables.messages
				.find({ workspace_id: workspaceId, conversation_id: chatId })
				.toArray();
			return rows.map(messageFromRow).sort(byMessageTsAsc);
		},

		async appendChatMessage(
			workspaceId: string,
			chatId: string,
			input: AppendChatMessageInput,
		): Promise<MessageRecord> {
			await assertChat(state, workspaceId, chatId);
			const messageId = input.messageId ?? randomUUID();
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
			// Cluster key is `(message_ts ASC)`. We don't probe for an
			// existing row first (`message_id` isn't part of the key, so a
			// `findOne` filter on it isn't a partition lookup) — Astra
			// allows multiple rows in the same partition with different
			// timestamps, and the contract is "callers either let the store
			// stamp or supply a unique pair." If a duplicate (workspace,
			// chat, ts, id) ever does happen, the second insertOne becomes
			// an upsert; acceptable for v0.
			await state.tables.messages.insertOne(messageToRow(record));
			return record;
		},

		async updateChatMessage(
			workspaceId: string,
			chatId: string,
			messageId: string,
			patch: UpdateChatMessageInput,
		): Promise<MessageRecord> {
			await assertChat(state, workspaceId, chatId);
			// `message_id` isn't part of the cluster key, so we read the
			// matching partition and find by id client-side. v0 chats are
			// bounded; if message lists grow large we'll add a `_by_id`
			// secondary index.
			const rows = await state.tables.messages
				.find({ workspace_id: workspaceId, conversation_id: chatId })
				.toArray();
			const existingRow = rows.find((r) => r.message_id === messageId);
			if (!existingRow) {
				throw new ControlPlaneNotFoundError("chat message", messageId);
			}
			const existing = messageFromRow(existingRow);
			const next: MessageRecord = {
				...existing,
				...(patch.content !== undefined && { content: patch.content }),
				...(patch.tokenCount !== undefined && { tokenCount: patch.tokenCount }),
				...(patch.metadata !== undefined && {
					metadata: mergeMessageMetadata(existing.metadata, patch.metadata),
				}),
			};
			const nextRow = messageToRow(next);
			await state.tables.messages.updateOne(
				{
					workspace_id: workspaceId,
					conversation_id: chatId,
					message_ts: existingRow.message_ts,
				},
				{
					$set: {
						content: nextRow.content,
						token_count: nextRow.token_count,
						metadata: nextRow.metadata,
					},
				},
			);
			return next;
		},
	};
}
