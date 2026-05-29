import { describe, expect, test, vi } from "vitest";
import { MemoryJobStore } from "../../src/jobs/memory-store.js";
import { ResumeRegistry } from "../../src/jobs/resume-registry.js";
import {
	JobOrphanSweeper,
	type SweepCallback,
	type SweepHandle,
	type SweepScheduler,
} from "../../src/jobs/sweeper.js";

const WORKSPACE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

class ManualSweepScheduler implements SweepScheduler {
	private cb: SweepCallback | null = null;
	start(callback: SweepCallback): SweepHandle {
		this.cb = callback;
		return {
			stop: () => {
				this.cb = null;
			},
		};
	}
	async tick(): Promise<void> {
		if (this.cb) await this.cb();
	}
	get callbackCount(): number {
		return this.cb ? 1 : 0;
	}
}

describe("JobOrphanSweeper", () => {
	test("reclaims stale running jobs and marks them failed", async () => {
		const jobs = new MemoryJobStore();
		const job = await jobs.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		await jobs.update(WORKSPACE_A, job.jobId, {
			status: "running",
			leasedBy: "wb-replica-old",
			leasedAt: "2020-01-01T00:00:00.000Z",
		});

		const scheduler = new ManualSweepScheduler();
		const sweeper = new JobOrphanSweeper({
			jobs,
			replicaId: "wb-replica-new",
			graceMs: 1_000,
			scheduler,
		});
		sweeper.start();

		await scheduler.tick();

		const after = await jobs.get(WORKSPACE_A, job.jobId);
		expect(after?.status).toBe("failed");
		expect(after?.errorMessage).toMatch(/lease expired/);
		expect(after?.leasedBy).toBeNull();
		expect(after?.leasedAt).toBeNull();
		sweeper.stop();
	});

	test("ignores fresh-leased running jobs", async () => {
		const jobs = new MemoryJobStore();
		const job = await jobs.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		await jobs.update(WORKSPACE_A, job.jobId, {
			status: "running",
			leasedBy: "wb-replica-live",
			// Heartbeat right now; should NOT be reclaimed.
			leasedAt: new Date().toISOString(),
		});

		const scheduler = new ManualSweepScheduler();
		const sweeper = new JobOrphanSweeper({
			jobs,
			replicaId: "wb-replica-sweep",
			graceMs: 60_000,
			scheduler,
		});
		sweeper.start();
		await scheduler.tick();

		const after = await jobs.get(WORKSPACE_A, job.jobId);
		expect(after?.status).toBe("running");
		expect(after?.leasedBy).toBe("wb-replica-live");
		sweeper.stop();
	});

	test("ignores pending and terminal jobs regardless of lease state", async () => {
		const jobs = new MemoryJobStore();
		const pending = await jobs.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		const succeeded = await jobs.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		await jobs.update(WORKSPACE_A, succeeded.jobId, {
			status: "succeeded",
			leasedBy: null,
			leasedAt: null,
		});

		const scheduler = new ManualSweepScheduler();
		const sweeper = new JobOrphanSweeper({
			jobs,
			replicaId: "wb-replica-x",
			graceMs: 1,
			scheduler,
		});
		sweeper.start();
		await scheduler.tick();

		expect((await jobs.get(WORKSPACE_A, pending.jobId))?.status).toBe(
			"pending",
		);
		expect((await jobs.get(WORKSPACE_A, succeeded.jobId))?.status).toBe(
			"succeeded",
		);
		sweeper.stop();
	});

	test("only one of two racing sweepers reclaims a given orphan", async () => {
		// Both sweepers see the same stale row; the second one's CAS
		// fails because the first stamped a different leaseholder.
		const jobs = new MemoryJobStore();
		const job = await jobs.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		await jobs.update(WORKSPACE_A, job.jobId, {
			status: "running",
			leasedBy: "wb-replica-old",
			leasedAt: "2020-01-01T00:00:00.000Z",
		});

		const schedA = new ManualSweepScheduler();
		const schedB = new ManualSweepScheduler();
		const sweeperA = new JobOrphanSweeper({
			jobs,
			replicaId: "wb-replica-a",
			graceMs: 1_000,
			scheduler: schedA,
		});
		const sweeperB = new JobOrphanSweeper({
			jobs,
			replicaId: "wb-replica-b",
			graceMs: 1_000,
			scheduler: schedB,
		});
		sweeperA.start();
		sweeperB.start();

		// A goes first, claims, marks failed. B then ticks: the row no
		// longer matches `findStaleRunning` (status flipped to failed),
		// so B does nothing.
		await schedA.tick();
		await schedB.tick();

		const after = await jobs.get(WORKSPACE_A, job.jobId);
		expect(after?.status).toBe("failed");
		// errorMessage was set by A's update; B's tick saw nothing to
		// reclaim and didn't touch the row.
		expect(after?.errorMessage).toMatch(/lease expired/);
		sweeperA.stop();
		sweeperB.stop();
	});

	test("stop() halts the sweeper", async () => {
		const jobs = new MemoryJobStore();
		const scheduler = new ManualSweepScheduler();
		const sweeper = new JobOrphanSweeper({
			jobs,
			replicaId: "wb-replica-x",
			scheduler,
		});
		sweeper.start();
		expect(scheduler.callbackCount).toBe(1);
		sweeper.stop();
		expect(scheduler.callbackCount).toBe(0);
	});

	test("invokes the registered resume callback with the persisted snapshot on reclaim", async () => {
		// When the orphan carries a persisted snapshot AND its kind has a
		// registered resume callback, the sweeper hands off to that
		// callback instead of marking the job failed. Verifies the
		// (workspaceId, jobId, replicaId, snapshot) handoff shape.
		const jobs = new MemoryJobStore();
		const job = await jobs.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
			inputSnapshot: {
				text: "resume me",
				metadata: { source: "abandoned.md" },
			},
		});
		await jobs.update(WORKSPACE_A, job.jobId, {
			status: "running",
			leasedBy: "wb-replica-old",
			leasedAt: "2020-01-01T00:00:00.000Z",
		});

		const resume = vi.fn(async () => undefined);
		const resumes = new ResumeRegistry().register("ingest", resume);
		const scheduler = new ManualSweepScheduler();
		const sweeper = new JobOrphanSweeper({
			jobs,
			replicaId: "wb-replica-resumer",
			graceMs: 1_000,
			scheduler,
			resumes,
		});
		sweeper.start();
		await scheduler.tick();

		expect(resume).toHaveBeenCalledTimes(1);
		expect(resume).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_A,
			jobId: job.jobId,
			replicaId: "wb-replica-resumer",
			snapshot: { text: "resume me", metadata: { source: "abandoned.md" } },
		});
		// The sweeper does NOT mark the job failed when handing off —
		// the worker drives terminal state itself.
		const after = await jobs.get(WORKSPACE_A, job.jobId);
		expect(after?.status).toBe("running");
		expect(after?.leasedBy).toBe("wb-replica-resumer");
		sweeper.stop();
	});

	test("falls back to mark-failed when no resume hook is wired", async () => {
		// If the runtime declines to register a resume callback for the
		// kind, orphans-with-snapshot still flow through the legacy "fail
		// cleanly" path so SSE clients see a terminal state. The
		// errorMessage hints at the missing hook.
		const jobs = new MemoryJobStore();
		const job = await jobs.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
			inputSnapshot: { text: "would-be resumed" },
		});
		await jobs.update(WORKSPACE_A, job.jobId, {
			status: "running",
			leasedBy: "wb-replica-old",
			leasedAt: "2020-01-01T00:00:00.000Z",
		});

		const scheduler = new ManualSweepScheduler();
		const sweeper = new JobOrphanSweeper({
			jobs,
			replicaId: "wb-replica-x",
			graceMs: 1_000,
			scheduler,
		});
		sweeper.start();
		await scheduler.tick();

		const after = await jobs.get(WORKSPACE_A, job.jobId);
		expect(after?.status).toBe("failed");
		expect(after?.errorMessage).toMatch(/no resume hook/);
		sweeper.stop();
	});

	test("falls back to mark-failed when the snapshot is null even with a registered resume callback", async () => {
		// Pre-snapshot rows (or kinds that don't persist a snapshot) have
		// nothing to replay; the sweeper must skip the resume path so the
		// callback isn't called with a null snapshot.
		const jobs = new MemoryJobStore();
		const job = await jobs.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		await jobs.update(WORKSPACE_A, job.jobId, {
			status: "running",
			leasedBy: "wb-replica-old",
			leasedAt: "2020-01-01T00:00:00.000Z",
		});

		const resume = vi.fn();
		const resumes = new ResumeRegistry().register("ingest", resume);
		const scheduler = new ManualSweepScheduler();
		const sweeper = new JobOrphanSweeper({
			jobs,
			replicaId: "wb-replica-x",
			graceMs: 1_000,
			scheduler,
			resumes,
		});
		sweeper.start();
		await scheduler.tick();

		expect(resume).not.toHaveBeenCalled();
		const after = await jobs.get(WORKSPACE_A, job.jobId);
		expect(after?.status).toBe("failed");
		sweeper.stop();
	});

	test("a tick failure (e.g. transient store error) is logged but doesn't crash", async () => {
		// findStaleRunning rejecting must not throw out of tick(); the
		// sweeper logs and survives.
		const jobs = new MemoryJobStore();
		const errSpy = vi
			.spyOn(jobs, "findStaleRunning")
			.mockRejectedValueOnce(new Error("astra blip"));

		const scheduler = new ManualSweepScheduler();
		const sweeper = new JobOrphanSweeper({
			jobs,
			replicaId: "wb-replica-x",
			scheduler,
		});
		sweeper.start();
		await expect(scheduler.tick()).resolves.toBeUndefined();
		errSpy.mockRestore();
		sweeper.stop();
	});
});
