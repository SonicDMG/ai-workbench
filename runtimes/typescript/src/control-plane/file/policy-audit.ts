/**
 * Policy-audit aggregate slice (RLAC prototype) — file backend.
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../defaults.js";
import type {
	ListPolicyAuditOptions,
	PolicyAuditRepo,
	RecordPolicyDecisionInput,
} from "../store.js";
import type { PolicyAuditRecord } from "../types.js";
import { assertWorkspace, type FileStoreState } from "./state.js";

function dayOf(ts: string): string {
	return ts.slice(0, 10);
}

export function makePolicyAuditMethods(state: FileStoreState): PolicyAuditRepo {
	return {
		async recordPolicyDecision(
			workspace: string,
			input: RecordPolicyDecisionInput,
		): Promise<PolicyAuditRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("policy-audit", (rows) => {
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
				return { rows: [record, ...rows], result: record };
			});
		},

		async listPolicyAudit(
			workspace: string,
			options?: ListPolicyAuditOptions,
		): Promise<readonly PolicyAuditRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.readAll("policy-audit");
			let filtered = rows.filter((r) => r.workspaceId === workspace);
			if (options?.auditDay) {
				const day = options.auditDay;
				filtered = filtered.filter((r) => r.auditDay === day);
			}
			if (options?.principalId) {
				const pid = options.principalId;
				filtered = filtered.filter((r) => r.principalId === pid);
			}
			if (options?.knowledgeBaseId) {
				const kb = options.knowledgeBaseId;
				filtered = filtered.filter((r) => r.knowledgeBaseId === kb);
			}
			const limit = options?.limit ?? 100;
			return filtered.slice(0, limit);
		},
	};
}
