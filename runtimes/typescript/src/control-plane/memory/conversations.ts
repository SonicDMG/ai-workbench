/**
 * Conversation aggregate slice (agent-scoped). Owns the
 * `Map<${workspaceId}:${agentId}, Map<conversationId, ConversationRecord>>`
 * partition plus the cascade into chat messages on conversation
 * delete.
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import {
	byConversationCreatedAtDesc,
	freezeStringSet,
} from "../shared/records.js";
import type {
	ConversationRepo,
	CreateConversationInput,
	UpdateConversationInput,
} from "../store.js";
import type { ConversationRecord } from "../types.js";
import {
	assertAgent,
	assertWorkspace,
	type MemoryStoreState,
} from "./state.js";

export function makeConversationMethods(
	state: MemoryStoreState,
): ConversationRepo {
	return {
		async listConversations(
			workspaceId: string,
			agentId: string,
		): Promise<readonly ConversationRecord[]> {
			await assertWorkspace(state, workspaceId);
			const byChat = state.conversations.get(`${workspaceId}:${agentId}`);
			if (!byChat) return [];
			// Newest-first matches the table's `created_at DESC` cluster
			// ordering.
			return Array.from(byChat.values()).sort(byConversationCreatedAtDesc);
		},

		async getConversation(
			workspaceId: string,
			agentId: string,
			conversationId: string,
		): Promise<ConversationRecord | null> {
			await assertWorkspace(state, workspaceId);
			return (
				state.conversations
					.get(`${workspaceId}:${agentId}`)
					?.get(conversationId) ?? null
			);
		},

		async createConversation(
			workspaceId: string,
			agentId: string,
			input: CreateConversationInput,
		): Promise<ConversationRecord> {
			await assertAgent(state, workspaceId, agentId);
			const conversationId = input.conversationId ?? randomUUID();
			const key = `${workspaceId}:${agentId}`;
			const byChat = state.conversations.get(key) ?? new Map();
			if (byChat.has(conversationId)) {
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
			byChat.set(conversationId, record);
			state.conversations.set(key, byChat);
			return record;
		},

		async updateConversation(
			workspaceId: string,
			agentId: string,
			conversationId: string,
			patch: UpdateConversationInput,
		): Promise<ConversationRecord> {
			await assertWorkspace(state, workspaceId);
			const byChat = state.conversations.get(`${workspaceId}:${agentId}`);
			const existing = byChat?.get(conversationId);
			if (!existing) {
				throw new ControlPlaneNotFoundError("conversation", conversationId);
			}
			const next: ConversationRecord = {
				...existing,
				...(patch.title !== undefined && { title: patch.title }),
				...(patch.knowledgeBaseIds !== undefined && {
					knowledgeBaseIds: freezeStringSet(patch.knowledgeBaseIds),
				}),
			};
			byChat?.set(conversationId, next);
			return next;
		},

		async deleteConversation(
			workspaceId: string,
			agentId: string,
			conversationId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspaceId);
			const deleted =
				state.conversations
					.get(`${workspaceId}:${agentId}`)
					?.delete(conversationId) ?? false;
			if (deleted) {
				state.messages.delete(`${workspaceId}:${conversationId}`);
			}
			return { deleted };
		},
	};
}
