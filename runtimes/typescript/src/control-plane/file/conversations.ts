/**
 * Conversation aggregate slice (agent-scoped) for the file-backed
 * store. Cascades into chat messages on conversation delete.
 */

import { randomUUID } from "node:crypto";
import type { KeysetPage, ListPageOptions } from "../../lib/pagination.js";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import {
	byConversationCreatedAtDesc,
	CONVERSATION_PAGE_DIRECTION,
	conversationKeysetKey,
	freezeStringSet,
} from "../shared/records.js";
import type {
	ConversationRepo,
	CreateConversationInput,
	UpdateConversationInput,
} from "../store.js";
import type { ConversationRecord } from "../types.js";
import { assertAgent, assertWorkspace, type FileStoreState } from "./state.js";

export function makeConversationMethods(
	state: FileStoreState,
): ConversationRepo {
	return {
		async listConversations(
			workspaceId: string,
			agentId: string,
		): Promise<readonly ConversationRecord[]> {
			await assertWorkspace(state, workspaceId);
			const all = await state.readAll("conversations");
			return all
				.filter((c) => c.workspaceId === workspaceId && c.agentId === agentId)
				.sort(byConversationCreatedAtDesc);
		},

		async listConversationsPage(
			workspaceId: string,
			agentId: string,
			opts: ListPageOptions,
		): Promise<KeysetPage<ConversationRecord>> {
			await assertWorkspace(state, workspaceId);
			return state.readPage("conversations", {
				partition: [workspaceId, agentId],
				inPartition: (c) =>
					c.workspaceId === workspaceId && c.agentId === agentId,
				keyOf: conversationKeysetKey,
				direction: CONVERSATION_PAGE_DIRECTION,
				after: opts.after,
				limit: opts.limit,
			});
		},

		async getConversation(
			workspaceId: string,
			agentId: string,
			conversationId: string,
		): Promise<ConversationRecord | null> {
			await assertWorkspace(state, workspaceId);
			const all = await state.readAll("conversations");
			return (
				all.find(
					(c) =>
						c.workspaceId === workspaceId &&
						c.agentId === agentId &&
						c.conversationId === conversationId,
				) ?? null
			);
		},

		async createConversation(
			workspaceId: string,
			agentId: string,
			input: CreateConversationInput,
		): Promise<ConversationRecord> {
			await assertAgent(state, workspaceId, agentId);
			return state.mutate("conversations", (rows) => {
				const conversationId = input.conversationId ?? randomUUID();
				if (
					rows.some(
						(c) =>
							c.workspaceId === workspaceId &&
							c.agentId === agentId &&
							c.conversationId === conversationId,
					)
				) {
					throw new ControlPlaneConflictError(
						`conversation with id '${conversationId}' already exists`,
					);
				}
				const record: ConversationRecord = {
					workspaceId,
					agentId,
					conversationId,
					createdAt: nowIso(),
					title: input.title ?? null,
					knowledgeBaseIds: freezeStringSet(input.knowledgeBaseIds),
				};
				return { rows: [...rows, record], result: record };
			});
		},

		async updateConversation(
			workspaceId: string,
			agentId: string,
			conversationId: string,
			patch: UpdateConversationInput,
		): Promise<ConversationRecord> {
			await assertWorkspace(state, workspaceId);
			return state.mutate("conversations", (rows) => {
				const idx = rows.findIndex(
					(c) =>
						c.workspaceId === workspaceId &&
						c.agentId === agentId &&
						c.conversationId === conversationId,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("conversation", conversationId);
				}
				const existing = rows[idx] as ConversationRecord;
				const next: ConversationRecord = {
					...existing,
					...(patch.title !== undefined && { title: patch.title }),
					...(patch.knowledgeBaseIds !== undefined && {
						knowledgeBaseIds: freezeStringSet(patch.knowledgeBaseIds),
					}),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},

		async deleteConversation(
			workspaceId: string,
			agentId: string,
			conversationId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspaceId);
			const res = await state.mutate("conversations", (rows) => {
				const next = rows.filter(
					(c) =>
						!(
							c.workspaceId === workspaceId &&
							c.agentId === agentId &&
							c.conversationId === conversationId
						),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});
			if (res.deleted) {
				await state.mutate("messages", (rows) => ({
					rows: rows.filter(
						(m) =>
							!(
								m.workspaceId === workspaceId &&
								m.conversationId === conversationId
							),
					),
					result: null,
				}));
			}
			return res;
		},
	};
}
