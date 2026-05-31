import type { ConversationRecord } from "../../control-plane/types.js";
import type { ConversationRow } from "../row-types.js";
import { arrayToSet, asUuidString, setToSortedArray } from "./coerce.js";

export function conversationToRow(r: ConversationRecord): ConversationRow {
	return {
		workspace_id: r.workspaceId,
		agent_id: r.agentId,
		conversation_id: r.conversationId,
		created_at: r.createdAt,
		title: r.title,
		// `null` and the empty set both mean "no KB filter — draw from
		// all KBs in the workspace." We send `null` to keep the wire
		// representation compact; reads coalesce both back to `[]`.
		knowledge_base_ids:
			r.knowledgeBaseIds.length > 0 ? arrayToSet(r.knowledgeBaseIds) : null,
	};
}

export function conversationFromRow(row: ConversationRow): ConversationRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		agentId: asUuidString(row.agent_id),
		conversationId: asUuidString(row.conversation_id),
		createdAt: row.created_at,
		title: row.title,
		knowledgeBaseIds: setToSortedArray(row.knowledge_base_ids),
	};
}
