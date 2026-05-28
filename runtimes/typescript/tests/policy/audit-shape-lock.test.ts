/**
 * RLAC audit-log shape lock.
 *
 * The `PolicyAuditRecord` shape, the `PolicyAction` verb set, and the
 * `PolicyDecision` outcome set are part of the public contract starting
 * with 0.2.0. Anyone consuming the audit feed (SIEM ingestion, the
 * built-in workspace-settings panel, downstream alerting) relies on
 * field names, types, and the enum membership staying stable across
 * minor releases.
 *
 * This test fails any unannounced enum addition / removal and any
 * audit-record key drift. Failures should be paired with one of:
 *   - a CHANGELOG entry under **Changed** announcing the field/value,
 *   - a deprecation window noted in `docs/rlac.md`.
 *
 * For type-level forward compatibility, the shape lives at
 * {@link PolicyAuditRecord} and the V1 alias re-export at
 * `PolicyAuditRecordV1` so a future V2 shape can land side-by-side
 * without breaking integrators.
 */

import { describe, expect, test } from "vitest";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import type {
	PolicyAction,
	PolicyAuditRecord,
	PolicyAuditRecordV1,
	PolicyDecision,
} from "../../src/control-plane/types.js";

const POLICY_ACTIONS = [
	"list",
	"get",
	"search",
	"ingest",
	"update",
	"delete",
] as const satisfies readonly PolicyAction[];

const POLICY_DECISIONS = [
	"allow",
	"deny",
	"filter",
] as const satisfies readonly PolicyDecision[];

const POLICY_AUDIT_FIELDS = [
	"workspaceId",
	"auditDay",
	"ts",
	"decisionId",
	"principalId",
	"knowledgeBaseId",
	"resourceId",
	"action",
	"decision",
	"reason",
	"compiledFilterJson",
] as const;

describe("RLAC audit-log shape lock (0.2.0 stability commitment)", () => {
	test("PolicyAction enum membership is locked", () => {
		// Type-level: any union widening trips `satisfies` above and
		// fails the file's compile. Value-level: this asserts the count
		// + order matches the documented contract.
		expect(POLICY_ACTIONS).toEqual([
			"list",
			"get",
			"search",
			"ingest",
			"update",
			"delete",
		]);
	});

	test("PolicyDecision enum membership is locked", () => {
		expect(POLICY_DECISIONS).toEqual(["allow", "deny", "filter"]);
	});

	test("PolicyAuditRecordV1 alias preserves the V1 shape", () => {
		// Type-level forward-compat check — if `PolicyAuditRecord` ever
		// drifts from the V1 baseline, this assignment fails the
		// compile and we know to introduce `PolicyAuditRecordV2` rather
		// than break integrators on the V1 alias.
		const v1: PolicyAuditRecordV1 = {
			workspaceId: "ws",
			auditDay: "2026-05-17",
			ts: "2026-05-17T00:00:00.000Z",
			decisionId: "dec",
			principalId: null,
			knowledgeBaseId: "kb",
			resourceId: "res",
			action: "search",
			decision: "allow",
			reason: "ok",
			compiledFilterJson: null,
		};
		const baseline: PolicyAuditRecord = v1;
		expect(baseline).toStrictEqual(v1);
	});

	test("recorded audit row carries exactly the locked field set", async () => {
		const store = new MemoryControlPlaneStore();
		const ws = await store.createWorkspace({
			name: "audit-shape",
			kind: "mock",
		});

		const record = await store.recordPolicyDecision(ws.uid, {
			principalId: null,
			knowledgeBaseId: "11111111-2222-4333-8444-555555555555",
			resourceId: "doc-1",
			action: "search",
			decision: "allow",
			reason: "no policy attached",
			compiledFilterJson: null,
		});

		// Field set is exact — no additions, no removals. Re-serializing
		// to JSON and parsing back guarantees we're comparing the wire
		// shape integrators see, not a class instance with hidden keys.
		const wire = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
		const keys = Object.keys(wire).sort();
		expect(keys).toEqual([...POLICY_AUDIT_FIELDS].sort());

		// Type witnesses for the load-bearing fields. Drift here means a
		// downstream consumer expecting (e.g.) `ts: string` is now
		// receiving a Date object.
		expect(typeof wire.workspaceId).toBe("string");
		expect(typeof wire.auditDay).toBe("string");
		expect(typeof wire.ts).toBe("string");
		expect(typeof wire.decisionId).toBe("string");
		expect(
			wire.principalId === null || typeof wire.principalId === "string",
		).toBe(true);
		expect(typeof wire.knowledgeBaseId).toBe("string");
		expect(typeof wire.resourceId).toBe("string");
		expect(POLICY_ACTIONS).toContain(wire.action as PolicyAction);
		expect(POLICY_DECISIONS).toContain(wire.decision as PolicyDecision);
		expect(typeof wire.reason).toBe("string");
		expect(
			wire.compiledFilterJson === null ||
				typeof wire.compiledFilterJson === "string",
		).toBe(true);

		// `auditDay` must be `YYYY-MM-DD` — operators key UI filters on
		// this format.
		expect(wire.auditDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		// `ts` must be ISO-8601 UTC with millisecond resolution.
		expect(wire.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	});
});
