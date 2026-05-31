import type { MessageRecord } from "../../control-plane/types.js";
import type { MessageRow } from "../row-types.js";
import {
	asNumberOrNull,
	asPlainStringMap,
	asUuidString,
	parseJsonObject,
} from "./coerce.js";

export function messageToRow(r: MessageRecord): MessageRow {
	return {
		workspace_id: r.workspaceId,
		conversation_id: r.conversationId,
		message_ts: r.messageTs,
		message_id: r.messageId,
		role: r.role,
		author_id: r.authorId,
		content: r.content,
		tool_id: r.toolId,
		tool_call_payload: r.toolCallPayload
			? JSON.stringify(r.toolCallPayload)
			: null,
		tool_response: r.toolResponse ? JSON.stringify(r.toolResponse) : null,
		token_count: r.tokenCount,
		metadata: { ...r.metadata },
	};
}

export function messageFromRow(row: MessageRow): MessageRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		conversationId: asUuidString(row.conversation_id),
		messageTs: row.message_ts,
		messageId: asUuidString(row.message_id),
		role: row.role,
		authorId: row.author_id == null ? null : asUuidString(row.author_id),
		content: row.content,
		// `tool_id` is text (tool *name*), not a UUID — see the schema
		// note in `MESSAGES_DEFINITION`. Pass through verbatim.
		toolId: row.tool_id ?? null,
		toolCallPayload: parseJsonObject(row.tool_call_payload),
		toolResponse: parseJsonObject(row.tool_response),
		tokenCount: asNumberOrNull(row.token_count),
		metadata: asPlainStringMap(row.metadata),
	};
}
