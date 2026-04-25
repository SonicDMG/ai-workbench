/**
 * Orphan sweeper for async-ingest jobs.
 *
 * Final slice of [`docs/cross-replica-jobs.md`](../../../../docs/cross-replica-jobs.md).
 * On a long interval (default 60s) every replica that runs a sweeper
 * scans `JobStore.findStaleRunning()` for `status: "running"` records
 * whose `leasedAt` is older than a grace window. Each candidate runs
 * through {@link JobStore.claim} — a CAS-style update that succeeds
 * only if the row's current `leasedBy` matches what we observed.
 * Replicas that lose the race skip silently; the winner marks the
 * orphan `failed` with a sanitized error message so the SSE stream
 * closes and clients see a terminal state.
 *
 * Resume — actually re-running the pipeline from `processed` — is a
 * follow-up. To do it the sweeper would need the original
 * `IngestRequest` (text, sourceFilename, chunker options) which the
 * current schema doesn't persist. Adding `ingest_input_json` to the
 * job table is a one-column migration; documenting the gap here so
 * the sweeper's behavior stays explicit until then.
 *
 * The sweeper is **opt-in** via `controlPlane.jobsResume` config.
 * Single-replica deployments leave it off (their pipeline always
 * fails-fast on the same process), and the cost of M replicas
 * scanning the same job table once a minute stays at zero until
 * someone consciously turns it on.
 */

import { logger } from "../lib/logger.js";
import type { JobStore } from "./store.js";

export interface JobSweeperOptions {
	readonly jobs: JobStore;
	readonly replicaId: string;
	/** Grace window in ms before a `running` job's lease is considered
	 * abandoned. Default 60s; should be > the worker's heartbeat
	 * cadence (today: every progress callback, ~ms-scale) plus a wide
	 * margin for the worker stalling on a slow embedder. */
	readonly graceMs?: number;
	/** How often to scan. Default 60s. The sweeper costs one
	 * `find({status: "running"})` per tick; cheap, but no point doing
	 * it more often than the grace window. */
	readonly intervalMs?: number;
	/** Replace `setInterval` for tests. */
	readonly scheduler?: SweepScheduler;
}

export type SweepCallback = () => void | Promise<void>;
export interface SweepScheduler {
	start(callback: SweepCallback, intervalMs: number): SweepHandle;
}
export interface SweepHandle {
	stop(): void;
}

const DEFAULT_GRACE_MS = 60_000;
const DEFAULT_INTERVAL_MS = 60_000;

const defaultScheduler: SweepScheduler = {
	start(cb, intervalMs) {
		const handle = setInterval(cb, intervalMs);
		if (typeof handle === "object" && "unref" in handle) {
			(handle as { unref(): void }).unref();
		}
		return {
			stop() {
				clearInterval(handle);
			},
		};
	},
};

/**
 * Cross-replica orphan sweeper. Construct, call `start()`. Call
 * `stop()` from the runtime's graceful-shutdown hook so the timer
 * doesn't hold the process open.
 *
 * `tick()` is exposed so tests don't have to wait on a real timer.
 */
export class JobOrphanSweeper {
	private readonly jobs: JobStore;
	private readonly replicaId: string;
	private readonly graceMs: number;
	private readonly intervalMs: number;
	private readonly scheduler: SweepScheduler;
	private handle: SweepHandle | null = null;
	private running = false;

	constructor(opts: JobSweeperOptions) {
		this.jobs = opts.jobs;
		this.replicaId = opts.replicaId;
		this.graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
		this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.scheduler = opts.scheduler ?? defaultScheduler;
	}

	start(): void {
		if (this.handle) return;
		this.handle = this.scheduler.start(() => this.tick(), this.intervalMs);
	}

	stop(): void {
		this.handle?.stop();
		this.handle = null;
	}

	/** Run a single sweep. Resolves after every claimable orphan has
	 * been processed (sequentially — concurrency would just rack up
	 * Astra round-trips for no benefit at this scale). Tests await
	 * this directly. */
	async tick(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			const cutoff = new Date(Date.now() - this.graceMs).toISOString();
			const stale = await this.jobs.findStaleRunning(cutoff);
			if (stale.length === 0) return;
			for (const job of stale) {
				await this.processOne(job.workspace, job.jobId, job.leasedBy);
			}
		} catch (err) {
			logger.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"job orphan sweeper tick failed",
			);
		} finally {
			this.running = false;
		}
	}

	private async processOne(
		workspace: string,
		jobId: string,
		expectedHolder: string | null,
	): Promise<void> {
		const claimed = await this.jobs.claim(
			workspace,
			jobId,
			expectedHolder,
			this.replicaId,
		);
		if (!claimed) {
			// Another replica won the CAS. Nothing more to do —
			// their `update()` will mark the job failed.
			return;
		}
		// We own the lease. The current PR's resume story is
		// "fail it cleanly" — the original ingest input isn't
		// persisted yet, so we can't actually re-run the
		// pipeline. Mark failed with a clear, actionable error
		// so clients can surface "retry needed" instead of
		// hanging on a stuck `running` forever.
		try {
			await this.jobs.update(workspace, jobId, {
				status: "failed",
				errorMessage:
					"job lease expired — the replica that owned this ingest went away before completing it. Retry the request to start a fresh job.",
				leasedBy: null,
				leasedAt: null,
			});
			logger.info(
				{
					workspace,
					jobId,
					reclaimedBy: this.replicaId,
					previousHolder: expectedHolder,
				},
				"orphan job reclaimed and marked failed",
			);
		} catch (err) {
			logger.warn(
				{
					workspace,
					jobId,
					err: err instanceof Error ? err.message : String(err),
				},
				"orphan job claim succeeded but update failed",
			);
		}
	}
}
