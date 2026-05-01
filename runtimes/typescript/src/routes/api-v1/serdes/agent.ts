/**
 * Wire converters for agent + conversation + chat-message records.
 *
 * Each `to*Wire` function flattens the readonly internal record onto
 * the mutable wire shape the agent route's OpenAPI types expect.
 */

import type {
	AgentRecord,
	ConversationRecord,
	MessageRecord,
} from "../../../control-plane/types.js";

export interface AgentWire {
	workspaceId: string;
	agentId: string;
	name: string;
	description: string | null;
	systemPrompt: string | null;
	userPrompt: string | null;
	llmServiceId: string | null;
	knowledgeBaseIds: string[];
	ragEnabled: boolean;
	ragMaxResults: number | null;
	ragMinScore: number | null;
	rerankEnabled: boolean;
	rerankingServiceId: string | null;
	rerankMaxResults: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface ConversationWire {
	workspaceId: string;
	agentId: string;
	conversationId: string;
	title: string | null;
	knowledgeBaseIds: string[];
	createdAt: string;
}

export interface ChatMessageWire {
	workspaceId: string;
	chatId: string;
	messageId: string;
	messageTs: string;
	role: "user" | "agent" | "system";
	content: string | null;
	tokenCount: number | null;
	metadata: Record<string, string>;
}

export function toWireAgent(record: AgentRecord): AgentWire {
	return {
		workspaceId: record.workspaceId,
		agentId: record.agentId,
		name: record.name,
		description: record.description,
		systemPrompt: record.systemPrompt,
		userPrompt: record.userPrompt,
		// Coerce undefined → null so legacy file-stored rows that pre-date
		// the `llmServiceId` column don't leak `undefined` (which JSON
		// drops, breaking nullable-but-required client schemas).
		llmServiceId: record.llmServiceId ?? null,
		knowledgeBaseIds: [...record.knowledgeBaseIds],
		ragEnabled: record.ragEnabled,
		ragMaxResults: record.ragMaxResults,
		ragMinScore: record.ragMinScore,
		rerankEnabled: record.rerankEnabled,
		rerankingServiceId: record.rerankingServiceId,
		rerankMaxResults: record.rerankMaxResults,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

export function toWireConversation(
	record: ConversationRecord,
): ConversationWire {
	return {
		workspaceId: record.workspaceId,
		agentId: record.agentId,
		conversationId: record.conversationId,
		title: record.title,
		knowledgeBaseIds: [...record.knowledgeBaseIds],
		createdAt: record.createdAt,
	};
}

/**
 * Project a {@link MessageRecord} onto the `ChatMessage` wire shape.
 *
 * Callers that fetch a single record (e.g. the SSE emitter for
 * `user-message` / `done` events) get the literal projection. Callers
 * that page through history should run rows through
 * {@link isUserVisibleMessage} first — the dispatcher persists
 * scaffolding turns (tool results, pre-tool-call placeholders) that
 * are needed for the model's prompt history but should never appear
 * in a user-facing chat transcript.
 *
 * `tool` rows still collapse to `role: "agent"` here as a defensive
 * fallback so a stray tool record can't crash a wire schema with an
 * unrecognised role.
 */
export function toWireChatMessage(record: MessageRecord): ChatMessageWire {
	const role: "user" | "agent" | "system" =
		record.role === "tool" ? "agent" : record.role;
	return {
		workspaceId: record.workspaceId,
		chatId: record.conversationId,
		messageId: record.messageId,
		messageTs: record.messageTs,
		role,
		content: record.content,
		tokenCount: record.tokenCount,
		metadata: { ...record.metadata },
	};
}

/**
 * True when a persisted message belongs in a user-facing chat
 * transcript. Hides:
 *
 *  - `tool` rows: the tool's input + output payloads live in
 *    `toolCallPayload` / `toolResponse`, never in `content`. Surfacing
 *    them as `role: "agent"` with `content: null` produces blank
 *    bubbles in the UI.
 *  - `agent` rows the model emitted alongside a tool call but with no
 *    user-visible text (`content === ""` and
 *    `finish_reason === "tool_calls"`). These are the placeholder
 *    "I'm calling a tool" turn — the actual answer lands later in a
 *    `finish_reason: "stop"` turn.
 *
 * Both kinds are still persisted so `assemblePrompt` can replay the
 * full tool-call loop on subsequent turns; this predicate just filters
 * the public listing.
 */
export function isUserVisibleMessage(record: MessageRecord): boolean {
	if (record.role === "tool") return false;
	if (
		record.role === "agent" &&
		(record.content ?? "") === "" &&
		record.metadata.finish_reason === "tool_calls"
	) {
		return false;
	}
	return true;
}
