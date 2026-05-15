/**
 * Policy-audit aggregate slice (RLAC prototype).
 *
 * Append-only list per workspace. Memory-only; durability is irrelevant
 * for the prototype (the audit panel is a demo affordance, not a
 * compliance store).
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../defaults.js";
import type {
	ListPolicyAuditOptions,
	PolicyAuditRepo,
	RecordPolicyDecisionInput,
} from "../store.js";
import type { PolicyAuditRecord } from "../types.js";
import { assertWorkspace, type MemoryStoreState } from "./state.js";

function dayOf(ts: string): string {
	return ts.slice(0, 10);
}

export function makePolicyAuditMethods(
	state: MemoryStoreState,
): PolicyAuditRepo {
	return {
		async recordPolicyDecision(
			workspace: string,
			input: RecordPolicyDecisionInput,
		): Promise<PolicyAuditRecord> {
			await assertWorkspace(state, workspace);
			const ts = nowIso();
			const record: PolicyAuditRecord = {
				workspaceId: workspace,
				auditDay: dayOf(ts),
				ts,
				decisionId: randomUUID(),
				principalId: input.principalId,
				knowledgeBaseId: input.knowledgeBaseId,
				resourceId: input.resourceId,
				action: input.action,
				decision: input.decision,
				reason: input.reason,
				compiledFilterJson: input.compiledFilterJson ?? null,
			};
			const existing = state.policyAudit.get(workspace) ?? [];
			existing.unshift(record); // newest-first to mirror Astra clustering
			state.policyAudit.set(workspace, existing);
			return record;
		},

		async listPolicyAudit(
			workspace: string,
			options?: ListPolicyAuditOptions,
		): Promise<readonly PolicyAuditRecord[]> {
			await assertWorkspace(state, workspace);
			let records = state.policyAudit.get(workspace) ?? [];
			if (options?.auditDay) {
				const day = options.auditDay;
				records = records.filter((r) => r.auditDay === day);
			}
			if (options?.principalId) {
				const pid = options.principalId;
				records = records.filter((r) => r.principalId === pid);
			}
			if (options?.knowledgeBaseId) {
				const kb = options.knowledgeBaseId;
				records = records.filter((r) => r.knowledgeBaseId === kb);
			}
			const limit = options?.limit ?? 100;
			return records.slice(0, limit);
		},
	};
}
