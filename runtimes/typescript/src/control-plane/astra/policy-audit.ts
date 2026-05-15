/**
 * Policy-audit aggregate slice (RLAC prototype) — Astra backend.
 *
 * Backed by `wb_policy_audit_by_workspace`. Partitioned by
 * `(workspace_id, audit_day)` and clustered `ts DESC, decision_id` so
 * the route audit-list endpoint (newest-first within a day) gets the
 * right shape for free. Each decision is fire-and-forget from the
 * enforcer — a slow audit write should never block the request.
 */

import { randomUUID } from "node:crypto";
import {
	policyAuditFromRow,
	policyAuditToRow,
} from "../../astra-client/converters.js";
import { nowIso } from "../defaults.js";
import type {
	ListPolicyAuditOptions,
	PolicyAuditRepo,
	RecordPolicyDecisionInput,
} from "../store.js";
import type { PolicyAuditRecord } from "../types.js";
import { type AstraStoreState, assertWorkspace } from "./state.js";

function dayOf(ts: string): string {
	return ts.slice(0, 10);
}

export function makePolicyAuditMethods(
	state: AstraStoreState,
): PolicyAuditRepo {
	return {
		async recordPolicyDecision(
			workspace: string,
			input: RecordPolicyDecisionInput,
		): Promise<PolicyAuditRecord> {
			// Audit writes must never throw into the request path; the
			// enforcer wraps this with a fire-and-forget try/catch already.
			// Workspace assertion stays — auditing a request for a
			// nonexistent workspace would be wrong, but the caller would
			// have already 404'd before reaching this point.
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
			await state.tables.policyAudit.insertOne(policyAuditToRow(record));
			return record;
		},

		async listPolicyAudit(
			workspace: string,
			options?: ListPolicyAuditOptions,
		): Promise<readonly PolicyAuditRecord[]> {
			await assertWorkspace(state, workspace);
			// Data API partition lookups must pin `workspace_id` and
			// `audit_day`. The audit panel calls without `auditDay`
			// (newest decisions, any day), so fan out: today + the day
			// before. Two partitions covers the common case
			// (decisions from a live demo) without an unbounded scan.
			const today = dayOf(nowIso());
			const yesterday = previousDay(today);
			const days = options?.auditDay ? [options.auditDay] : [today, yesterday];
			const limit = options?.limit ?? 100;
			const all: PolicyAuditRecord[] = [];
			for (const day of days) {
				const rows = await state.tables.policyAudit
					.find({ workspace_id: workspace, audit_day: day })
					.toArray();
				for (const row of rows) {
					const record = policyAuditFromRow(row);
					if (
						options?.principalId &&
						record.principalId !== options.principalId
					)
						continue;
					if (
						options?.knowledgeBaseId &&
						record.knowledgeBaseId !== options.knowledgeBaseId
					)
						continue;
					all.push(record);
				}
			}
			// Cluster key sorts newest-first within a partition; merging
			// two days needs an explicit re-sort.
			all.sort((a, b) => b.ts.localeCompare(a.ts));
			return all.slice(0, limit);
		},
	};
}

function previousDay(day: string): string {
	const [y, m, d] = day.split("-").map(Number);
	if (!y || !m || !d) return day;
	const date = new Date(Date.UTC(y, m - 1, d));
	date.setUTCDate(date.getUTCDate() - 1);
	return date.toISOString().slice(0, 10);
}
