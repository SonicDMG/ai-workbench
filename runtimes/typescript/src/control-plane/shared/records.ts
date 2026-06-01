/**
 * Shared record-shape helpers for the three {@link ControlPlaneStore}
 * backends (memory, file, astra). Anything purely about *what a row
 * looks like* — independent of where the row lives — belongs here.
 *
 * Backend-specific concerns (lookup tables, file I/O, partition keys)
 * stay in each backend's own `store.ts`. The line is: if a function
 * doesn't touch `this`, it can move here.
 */

import type { KeysetKey } from "../../lib/pagination.js";
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

/**
 * Normalise an MCP-server `allowedTools` allow-list. Unlike
 * {@link freezeStringSet}, this preserves the `null` (expose every tool
 * the server advertises) vs `[]` (expose none) distinction the A2 tool
 * resolver relies on. An array is deduplicated, sorted, and frozen for a
 * deterministic wire shape; `null`/`undefined` collapse to `null`.
 */
export function normalizeAllowedTools(
	value: readonly string[] | null | undefined,
): readonly string[] | null {
	if (value === null || value === undefined) return null;
	return Object.freeze([...new Set(value)].sort());
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
 * Sort `rows` oldest-first ({@link byMessageTsAsc}) and return at most the
 * last `limit` of them — i.e. the most-recent window, still in
 * chronological order. Shared by every backend's `listRecentChatMessages`
 * so the tail is computed identically. `limit <= 0` yields an empty array;
 * `limit >= rows.length` yields the whole (sorted) set.
 */
export function recentMessagesTail(
	rows: readonly MessageRecord[],
	limit: number,
): readonly MessageRecord[] {
	if (limit <= 0) return [];
	const sorted = [...rows].sort(byMessageTsAsc);
	return sorted.length > limit ? sorted.slice(sorted.length - limit) : sorted;
}

/**
 * Keyset sort position for a conversation: `created_at` primary,
 * `conversation_id` tiebreak. Paired with {@link CONVERSATION_PAGE_DIRECTION}
 * (descending) it reproduces {@link byConversationCreatedAtDesc}.
 */
export function conversationKeysetKey(c: ConversationRecord): KeysetKey {
	return { k: c.createdAt, id: c.conversationId };
}

/**
 * Keyset sort position for a message: `message_ts` primary, `message_id`
 * tiebreak. Paired with {@link MESSAGE_PAGE_DIRECTION} (ascending) it
 * reproduces {@link byMessageTsAsc}.
 */
export function messageKeysetKey(m: MessageRecord): KeysetKey {
	return { k: m.messageTs, id: m.messageId };
}

/** Conversations page newest-first (`created_at DESC`). */
export const CONVERSATION_PAGE_DIRECTION = "desc" as const;

/** Messages page oldest-first (`message_ts ASC`). */
export const MESSAGE_PAGE_DIRECTION = "asc" as const;

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
		toolIds: freezeStringSet(input.toolIds ?? []),
		llmServiceId: input.llmServiceId ?? null,
		knowledgeBaseIds: freezeStringSet(input.knowledgeBaseIds),
		rerankEnabled: input.rerankEnabled ?? false,
		rerankingServiceId: input.rerankingServiceId ?? null,
		rerankMaxResults: input.rerankMaxResults ?? null,
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * Apply a partial patch to an existing record, copying defined values
 * (skipping `undefined`) onto a clone of `existing`, then layering
 * caller-supplied `overrides` on top. Backend-agnostic — used by every
 * service updater plus the workspace, KB, and agent updaters.
 *
 * Set-typed columns are not handled here because their input form
 * (`readonly string[] | ReadonlySet<string>`) doesn't match the record
 * form (`ReadonlySet<string>`); the call site overrides them after via
 * the `overrides` argument.
 */
export function applyPatch<TRecord extends object, TPatch extends object>(
	existing: TRecord,
	patch: TPatch,
	overrides: Partial<TRecord> = {},
): TRecord {
	const next = { ...existing } as Record<string, unknown>;
	for (const [k, v] of Object.entries(patch)) {
		if (v !== undefined) next[k] = v;
	}
	return { ...(next as TRecord), ...overrides };
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
