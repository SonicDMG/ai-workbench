/**
 * Pure-renderer tests for `aiw job status`. The citty wrapper itself
 * is exercised by the smoke tests; here we lock the human layout so a
 * regression in field ordering or progress formatting trips a unit
 * test rather than a customer dashboard.
 */

import { describe, expect, it } from "vitest";
import { renderJob } from "../src/commands/job.js";
import type { Job } from "../src/types.js";

const baseJob: Job = {
	jobId: "00000000-0000-0000-0000-000000000001",
};

describe("renderJob", () => {
	it("always emits an id line and an unknown-status fallback", () => {
		expect(renderJob(baseJob)).toContain(
			"id        00000000-0000-0000-0000-000000000001",
		);
		expect(renderJob(baseJob)).toContain("status    unknown");
	});

	it("renders kind, status, and progress (with total) when present", () => {
		const out = renderJob({
			...baseJob,
			kind: "ingest",
			status: "running",
			processed: 3,
			total: 10,
		});
		expect(out).toContain("kind      ingest");
		expect(out).toContain("status    running");
		expect(out).toContain("progress  3/10");
	});

	it("omits the total when total is null", () => {
		const out = renderJob({
			...baseJob,
			processed: 4,
			total: null,
		});
		expect(out).toContain("progress  4");
		expect(out).not.toContain("progress  4/");
	});

	it("omits progress entirely when `processed` is undefined", () => {
		const out = renderJob({
			...baseJob,
			status: "pending",
		});
		expect(out).not.toContain("progress");
	});

	it("renders kb / document / timestamps / errorMessage when present", () => {
		const out = renderJob({
			...baseJob,
			knowledgeBaseId: "kb-1",
			documentId: "doc-1",
			createdAt: "2026-05-27T10:00:00.000Z",
			updatedAt: "2026-05-27T10:05:00.000Z",
			errorMessage: "boom",
		});
		expect(out).toContain("kb        kb-1");
		expect(out).toContain("document  doc-1");
		expect(out).toContain("created   2026-05-27T10:00:00.000Z");
		expect(out).toContain("updated   2026-05-27T10:05:00.000Z");
		expect(out).toContain("error     boom");
	});
});
