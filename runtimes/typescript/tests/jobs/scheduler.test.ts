/**
 * Unit tests for `JobScheduler` — the generic lifecycle wrapper that
 * drives one job to terminal regardless of kind. Pins the lease,
 * heartbeat, success-result, and failure-capture semantics so a
 * second job kind plugging in later doesn't have to re-derive them.
 */

import { describe, expect, test } from "vitest";
import { MemoryJobStore } from "../../src/jobs/memory-store.js";
import { JobScheduler } from "../../src/jobs/scheduler.js";

describe("JobScheduler", () => {
	test("runs a registered handler to terminal and writes the result", async () => {
		const jobs = new MemoryJobStore();
		const scheduler = new JobScheduler(jobs);
		scheduler.register<{ items: number }>(
			"ingest",
			async ({ input, heartbeat }) => {
				heartbeat({ processed: 1, total: input.items });
				heartbeat({ processed: input.items, total: input.items });
				return { processed: input.items };
			},
		);

		const job = await jobs.create({
			workspace: "w-1",
			kind: "ingest",
			knowledgeBaseId: "kb-1",
			documentId: "doc-1",
		});

		await scheduler.run("w-1", job.jobId, "replica-1", { items: 4 });

		const final = await jobs.get("w-1", job.jobId);
		expect(final?.status).toBe("succeeded");
		expect(final?.result).toEqual({ processed: 4 });
		expect(final?.processed).toBe(4);
		expect(final?.total).toBe(4);
		expect(final?.leasedBy).toBeNull();
		expect(final?.leasedAt).toBeNull();
	});

	test("captures handler exceptions as failed + redacted errorMessage", async () => {
		const jobs = new MemoryJobStore();
		const scheduler = new JobScheduler(jobs);
		scheduler.register("ingest", async () => {
			throw new Error("boom");
		});

		const job = await jobs.create({
			workspace: "w-1",
			kind: "ingest",
			knowledgeBaseId: "kb-1",
			documentId: "doc-1",
		});

		await scheduler.run("w-1", job.jobId, "replica-1", undefined);

		const final = await jobs.get("w-1", job.jobId);
		expect(final?.status).toBe("failed");
		expect(final?.errorMessage).toBe("boom");
		expect(final?.leasedBy).toBeNull();
		expect(final?.leasedAt).toBeNull();
	});

	test("fails fast when no handler is registered for the job kind", async () => {
		const jobs = new MemoryJobStore();
		const scheduler = new JobScheduler(jobs);
		// No registrations.

		const job = await jobs.create({
			workspace: "w-1",
			kind: "ingest",
			knowledgeBaseId: null,
			documentId: null,
		});

		await scheduler.run("w-1", job.jobId, "replica-1", undefined);

		const final = await jobs.get("w-1", job.jobId);
		expect(final?.status).toBe("failed");
		expect(final?.errorMessage).toMatch(/no handler registered/);
	});

	test("is a no-op when the job is already terminal", async () => {
		const jobs = new MemoryJobStore();
		const scheduler = new JobScheduler(jobs);
		let calls = 0;
		scheduler.register("ingest", async () => {
			calls++;
			return null;
		});

		const job = await jobs.create({
			workspace: "w-1",
			kind: "ingest",
			knowledgeBaseId: null,
			documentId: null,
		});
		await jobs.update("w-1", job.jobId, {
			status: "succeeded",
			result: { ok: true },
		});

		await scheduler.run("w-1", job.jobId, "replica-1", undefined);
		expect(calls).toBe(0);
	});

	test("rejects duplicate handler registration", () => {
		const jobs = new MemoryJobStore();
		const scheduler = new JobScheduler(jobs);
		scheduler.register("ingest", async () => null);
		expect(() => scheduler.register("ingest", async () => null)).toThrow(
			/handler for kind 'ingest' already registered/,
		);
	});
});
