import type {
	PolicyAction,
	PolicyAuditRecord,
	PolicyDecision,
} from "../../control-plane/types.js";
import type { PolicyAuditRow } from "../row-types.js";
import { asIsoString, asUuidString } from "./coerce.js";

const POLICY_ACTIONS = new Set<PolicyAction>([
	"list",
	"get",
	"search",
	"ingest",
	"update",
	"delete",
]);
const POLICY_DECISIONS = new Set<PolicyDecision>(["allow", "deny", "filter"]);

function coercePolicyAction(value: string): PolicyAction {
	return POLICY_ACTIONS.has(value as PolicyAction)
		? (value as PolicyAction)
		: "list";
}

function coercePolicyDecision(value: string): PolicyDecision {
	return POLICY_DECISIONS.has(value as PolicyDecision)
		? (value as PolicyDecision)
		: "filter";
}

export function policyAuditToRow(r: PolicyAuditRecord): PolicyAuditRow {
	return {
		workspace_id: r.workspaceId,
		audit_day: r.auditDay,
		ts: r.ts,
		decision_id: r.decisionId,
		principal_id: r.principalId,
		knowledge_base_id: r.knowledgeBaseId,
		resource_id: r.resourceId,
		action: r.action,
		decision: r.decision,
		reason: r.reason,
		compiled_filter_json: r.compiledFilterJson,
	};
}

export function policyAuditFromRow(row: PolicyAuditRow): PolicyAuditRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		auditDay: row.audit_day,
		// `ts` is a `timestamp` column — astra-db-ts decodes it as a
		// JS `Date`. The audit slice sorts the merged two-day result
		// set with `localeCompare`, which throws on `Date`. Coerce here.
		ts: asIsoString(row.ts),
		decisionId: asUuidString(row.decision_id),
		principalId: row.principal_id ?? null,
		knowledgeBaseId: asUuidString(row.knowledge_base_id),
		resourceId: row.resource_id,
		action: coercePolicyAction(row.action),
		decision: coercePolicyDecision(row.decision),
		reason: row.reason,
		compiledFilterJson: row.compiled_filter_json ?? null,
	};
}
