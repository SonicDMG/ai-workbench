/**
 * Conversation aggregate slice (agent-scoped) for the Astra-backed
 * store. Owns `wb_conversations` plus the cascade into chat messages
 * on conversation delete.
 */

import { randomUUID } from "node:crypto";
import {
	conversationFromRow,
	conversationToRow,
} from "../../astra-client/converters.js";
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
import { type AstraStoreState, assertAgent, assertWorkspace } from "./state.js";

export function makeConversationMethods(
	state: AstraStoreState,
): ConversationRepo {
	return {
		async listConversations(
			workspaceId: string,
			agentId: string,
		): Promise<readonly ConversationRecord[]> {
			await assertWorkspace(state, workspaceId);
			const rows = await state.tables.conversations
				.find({ workspace_id: workspaceId, agent_id: agentId })
				.toArray();
			// Astra's `created_at DESC` cluster ordering is enforced server-
			// side, but the fake bundle in tests doesn't honor cluster keys.
			// Sort defensively so tests and prod agree.
			return rows.map(conversationFromRow).sort(byConversationCreatedAtDesc);
		},

		async listConversationsPage(
			workspaceId: string,
			agentId: string,
			opts: ListPageOptions,
		): Promise<KeysetPage<ConversationRecord>> {
			await assertWorkspace(state, workspaceId);
			// Single-partition server read; keyset slice runs locally so the
			// page order matches every backend even against the test fake.
			const rows = await state.tables.conversations
				.find({ workspace_id: workspaceId, agent_id: agentId })
				.toArray();
			return paginateKeyset(rows.map(conversationFromRow), {
				after: opts.after,
				limit: opts.limit,
				direction: CONVERSATION_PAGE_DIRECTION,
				keyOf: conversationKeysetKey,
			});
		},

		async getConversation(
			workspaceId: string,
			agentId: string,
			conversationId: string,
		): Promise<ConversationRecord | null> {
			await assertWorkspace(state, workspaceId);
			const row = await state.tables.conversations.findOne({
				workspace_id: workspaceId,
				agent_id: agentId,
				conversation_id: conversationId,
			});
			return row ? conversationFromRow(row) : null;
		},

		async createConversation(
			workspaceId: string,
			agentId: string,
			input: CreateConversationInput,
		): Promise<ConversationRecord> {
			await assertAgent(state, workspaceId, agentId);
			const conversationId = input.conversationId ?? randomUUID();
			const existing = await state.tables.conversations.findOne({
				workspace_id: workspaceId,
				agent_id: agentId,
				conversation_id: conversationId,
			});
			if (existing) {
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
			await state.tables.conversations.insertOne(conversationToRow(record));
			return record;
		},

		async updateConversation(
			workspaceId: string,
			agentId: string,
			conversationId: string,
			patch: UpdateConversationInput,
		): Promise<ConversationRecord> {
			await assertWorkspace(state, workspaceId);
			const existingRow = await state.tables.conversations.findOne({
				workspace_id: workspaceId,
				agent_id: agentId,
				conversation_id: conversationId,
			});
			if (!existingRow) {
				throw new ControlPlaneNotFoundError("conversation", conversationId);
			}
			const existing = conversationFromRow(existingRow);
			const next: ConversationRecord = {
				...existing,
				...(patch.title !== undefined && { title: patch.title }),
				...(patch.knowledgeBaseIds !== undefined && {
					knowledgeBaseIds: freezeStringSet(patch.knowledgeBaseIds),
				}),
			};
			const nextRow = conversationToRow(next);
			await state.tables.conversations.updateOne(
				{
					workspace_id: workspaceId,
					agent_id: agentId,
					created_at: existingRow.created_at,
					conversation_id: conversationId,
				},
				{
					$set: {
						title: nextRow.title,
						knowledge_base_ids: nextRow.knowledge_base_ids,
					},
				},
			);
			return next;
		},

		async deleteConversation(
			workspaceId: string,
			agentId: string,
			conversationId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspaceId);
			const existing = await state.tables.conversations.findOne({
				workspace_id: workspaceId,
				agent_id: agentId,
				conversation_id: conversationId,
			});
			if (!existing) return { deleted: false };
			await state.tables.conversations.deleteOne({
				workspace_id: workspaceId,
				agent_id: agentId,
				created_at: existing.created_at,
				conversation_id: conversationId,
			});
			await state.tables.messages.deleteMany({
				workspace_id: workspaceId,
				conversation_id: conversationId,
			});
			return { deleted: true };
		},
	};
}
