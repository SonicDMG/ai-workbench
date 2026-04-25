import { describe, expect, test, vi } from "vitest";
import { MemoryJobStore } from "../../src/jobs/memory-store.js";
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
