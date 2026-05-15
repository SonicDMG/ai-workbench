/**
 * Policy-audit aggregate (RLAC prototype).
 *
 * Append-only log of policy decisions. Writes are fire-and-forget from
 * the route layer; reads serve the audit-panel UI. List queries are
 * bounded by `(workspaceId, auditDay)` so a single read never scans
 * unbounded history.
 */

import type {
	PolicyAction,
	PolicyAuditRecord,
	PolicyDecision,
} from "../types.js";

export interface RecordPolicyDecisionInput {
	readonly principalId: string | null;
	readonly knowledgeBaseId: string;
	readonly resourceId: string;
	readonly action: PolicyAction;
	readonly decision: PolicyDecision;
	readonly reason: string;
	readonly compiledFilterJson?: string | null;
}

export interface ListPolicyAuditOptions {
	readonly auditDay?: string;
	readonly principalId?: string;
	readonly knowledgeBaseId?: string;
	readonly limit?: number;
}

export interface PolicyAuditRepo {
	recordPolicyDecision(
		workspace: string,
		input: RecordPolicyDecisionInput,
	): Promise<PolicyAuditRecord>;
	listPolicyAudit(
		workspace: string,
		options?: ListPolicyAuditOptions,
	): Promise<readonly PolicyAuditRecord[]>;
}
