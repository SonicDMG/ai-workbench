/**
 * Shared record-shape helpers for the three {@link ControlPlaneStore}
 * backends (memory, file, astra). Anything purely about *what a row
 * looks like* — independent of where the row lives — belongs here.
 *
 * Backend-specific concerns (lookup tables, file I/O, partition keys)
 * stay in each backend's own `store.ts`. The line is: if a function
 * doesn't touch `this`, it can move here.
 */

import { nowIso } from "../defaults.js";
import type { CreateAgentInput } from "../store.js";
import type {
	AgentRecord,
	ConversationRecord,
	MessageRecord,
} from "../types.js";

/**
 * Normalise a `Set | array | undefined` input into a deduplicated,
 * sorted, frozen array. Sorted because callers expect deterministic
 * ordering on the wire — and the Astra column type is `SET<TEXT>`,
 * which is also deduplicated.
 */
export function freezeStringSet(
	value: ReadonlySet<string> | readonly string[] | undefined,
): readonly string[] {
	const arr = [...new Set(value ?? [])].sort();
	return Object.freeze(arr);
}

/** Freeze a metadata-style `Record<string, string>` map (or empty). */
export function freezeMetadata(
	m: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
	return Object.freeze({ ...(m ?? {}) });
}

/** Freeze a knowledge-filter map (`Record<string, unknown>`). */
export function freezeFilter(
	filter: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
	return Object.freeze({ ...(filter ?? {}) });
}

/** Freeze a workspace credentials map (e.g. `{ token: "env:FOO" }`). */
export function freezeCredentials(
	c: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
	return Object.freeze({ ...(c ?? {}) });
}

/**
 * Newest-first sort for conversation rows, matching the Astra
 * `created_at DESC` cluster ordering on
 * `wb_agentic_conversations_by_agent`. Tie-break by conversation_id so
 * the result is a total order.
 */
export function byConversationCreatedAtDesc(
	a: ConversationRecord,
	b: ConversationRecord,
): number {
	if (a.createdAt > b.createdAt) return -1;
	if (a.createdAt < b.createdAt) return 1;
	if (a.conversationId < b.conversationId) return -1;
	if (a.conversationId > b.conversationId) return 1;
	return 0;
}

/**
 * Oldest-first sort for chat message rows, matching the Astra
 * `message_ts ASC` cluster ordering on
 * `wb_agentic_messages_by_conversation`.
 */
export function byMessageTsAsc(a: MessageRecord, b: MessageRecord): number {
	if (a.messageTs < b.messageTs) return -1;
	if (a.messageTs > b.messageTs) return 1;
	if (a.messageId < b.messageId) return -1;
	if (a.messageId > b.messageId) return 1;
	return 0;
}

/**
 * Oldest-first sort for agent rows. Agent listing uses creation order
 * so the first-created agent sits at the top of the list.
 */
export function byAgentCreatedAtAsc(a: AgentRecord, b: AgentRecord): number {
	if (a.createdAt < b.createdAt) return -1;
	if (a.createdAt > b.createdAt) return 1;
	if (a.agentId < b.agentId) return -1;
	if (a.agentId > b.agentId) return 1;
	return 0;
}

/**
 * Build a fresh {@link AgentRecord} from {@link CreateAgentInput}.
 * Centralised so memory/file/astra all default the same fields the
 * same way. Uniform construction is part of the cross-backend contract.
 */
export function buildAgentRecord(
	workspaceId: string,
	agentId: string,
	input: CreateAgentInput,
): AgentRecord {
	const now = nowIso();
	return {
		workspaceId,
		agentId,
		name: input.name,
		description: input.description ?? null,
		systemPrompt: input.systemPrompt ?? null,
		userPrompt: input.userPrompt ?? null,
		toolIds: freezeStringSet([]),
		llmServiceId: input.llmServiceId ?? null,
		ragEnabled: input.ragEnabled ?? false,
		knowledgeBaseIds: freezeStringSet(input.knowledgeBaseIds),
		ragMaxResults: input.ragMaxResults ?? null,
		ragMinScore: input.ragMinScore ?? null,
		rerankEnabled: input.rerankEnabled ?? false,
		rerankingServiceId: input.rerankingServiceId ?? null,
		rerankMaxResults: input.rerankMaxResults ?? null,
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * Merge a metadata patch into an existing metadata map. Patch values
 * of `undefined` drop the corresponding key (mirroring the
 * `UpdateChatMessageInput` contract).
 */
export function mergeMetadata(
	existing: Readonly<Record<string, string>>,
	patch: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
	const next: Record<string, string> = { ...existing };
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) delete next[k];
		else next[k] = v;
	}
	return Object.freeze(next);
}
