/**
 * Orphan sweeper for async-ingest jobs.
 *
 * Final slice of [`docs/cross-replica-jobs.md`](../../../../docs/cross-replica-jobs.md).
 * On a long interval (default 60s) every replica that runs a sweeper
 * scans `JobStore.findStaleRunning()` for `status: "running"` records
 * whose `leasedAt` is older than a grace window. Each candidate runs
 * through {@link JobStore.claim} — a CAS-style update that succeeds
 * only if the row's current `leasedBy` matches what we observed.
 * Replicas that lose the race skip silently.
 *
 * On a successful claim:
 * - If the job carries an `ingestInput` snapshot **and** a
 *   `resume` callback is provided, the sweeper hands off to the
 *   shared async-ingest worker which replays the pipeline (chunk
 *   IDs are deterministic so re-upserting is idempotent — wasted
 *   embedding cost, correct final state).
 * - Otherwise the sweeper marks the orphan `failed` with an
 *   actionable error so SSE clients see a terminal state. This is
 *   the path for jobs created before the `ingest_input_json`
 *   column shipped (no input snapshot available) or when the
 *   runtime declines to wire a resume callback.
 *
 * The sweeper is **opt-in** via `controlPlane.jobsResume` config.
 * Single-replica deployments leave it off (their pipeline always
 * fails-fast on the same process), and the cost of M replicas
 * scanning the same job table once a minute stays at zero until
 * someone consciously turns it on.
 */

import { logger } from "../lib/logger.js";
import type { JobStore } from "./store.js";
import type { IngestInputSnapshot, JobRecord } from "./types.js";

/** Callback invoked by the sweeper after a successful CAS-claim,
 * when the orphan has an `ingestInput` snapshot. The runtime wires
 * this to the shared async-ingest worker. Must be detached (the
 * sweeper does not await this) and must drive the job to terminal
 * state itself. */
export type ResumeIngestCallback = (args: {
	workspaceId: string;
	jobId: string;
	replicaId: string;
	input: IngestInputSnapshot;
}) => void | Promise<void>;

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
	/** Optional resume hook. When set, jobs with an `ingestInput`
	 * snapshot are handed off here after claim instead of being
	 * marked failed. Wired to the async-ingest worker by `root.ts`. */
	readonly resume?: ResumeIngestCallback;
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
	private readonly resume: ResumeIngestCallback | null;
	private handle: SweepHandle | null = null;
	private running = false;

	constructor(opts: JobSweeperOptions) {
		this.jobs = opts.jobs;
		this.replicaId = opts.replicaId;
		this.graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
		this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.scheduler = opts.scheduler ?? defaultScheduler;
		this.resume = opts.resume ?? null;
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
				await this.processOne(job);
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

	private async processOne(orphan: JobRecord): Promise<void> {
		const { workspace, jobId, leasedBy: expectedHolder, ingestInput } = orphan;
		const claimed = await this.jobs.claim(
			workspace,
			jobId,
			expectedHolder,
			this.replicaId,
		);
		if (!claimed) {
			// Another replica won the CAS. Nothing more to do —
			// the winner will drive the job to terminal.
			return;
		}

		// We own the lease.
		// (1) Resume path: the orphan carries an ingest input snapshot
		//     and the runtime wired a resume callback. Hand off to the
		//     shared async-ingest worker; idempotent re-upsert
		//     (chunk IDs are deterministic).
		if (ingestInput && this.resume) {
			try {
				await this.resume({
					workspaceId: workspace,
					jobId,
					replicaId: this.replicaId,
					input: ingestInput,
				});
				logger.info(
					{
						workspace,
						jobId,
						reclaimedBy: this.replicaId,
						previousHolder: expectedHolder,
					},
					"orphan job reclaimed and resumed",
				);
			} catch (err) {
				// `resume` is expected to handle its own failures and
				// stamp the job `failed`; this catch is belt-and-
				// suspenders for an unhandled rejection.
				logger.warn(
					{
						workspace,
						jobId,
						err: err instanceof Error ? err.message : String(err),
					},
					"orphan job resume threw",
				);
			}
			return;
		}

		// (2) Fail-cleanly path: no input snapshot, or the runtime
		//     declined to wire a resume hook. Mark failed with an
		//     actionable error so clients see a terminal state instead
		//     of a permanently `running` job.
		try {
			const message = ingestInput
				? "job lease expired and no resume hook is configured. Retry the request to start a fresh job."
				: "job lease expired — the replica that owned this ingest went away before completing it. Retry the request to start a fresh job.";
			await this.jobs.update(workspace, jobId, {
				status: "failed",
				errorMessage: message,
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
