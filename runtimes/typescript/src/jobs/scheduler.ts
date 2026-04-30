/**
 * JobScheduler — generic lifecycle wrapper for async work backed by a
 * {@link JobStore}.
 *
 * Today the only consumer is the KB ingest worker; the abstraction
 * exists so the second async kind (vector reindex, bulk export, the
 * cross-replica job design note in `docs/cross-replica-jobs.md`) can
 * plug in without re-implementing the claim → run → terminal +
 * heartbeat dance every time.
 *
 * A {@link JobHandler} is a per-kind function that runs one job to
 * terminal. The scheduler:
 *   - claims the lease (status → `running`, stamps `leasedBy` /
 *     `leasedAt`)
 *   - calls the handler with a `heartbeat()` callback so the handler
 *     can bump `processed` / `total` mid-flight without owning the
 *     `leasedAt` mechanic
 *   - on success, writes `status: "succeeded"` + the handler's
 *     `result` payload and clears the lease
 *   - on throw, writes `status: "failed"` + a redacted error message
 *     and clears the lease
 *   - short-circuits on already-terminal or unknown jobs
 *
 * Handlers are registered per {@link JobKind} via {@link JobScheduler.register}.
 * Adding a new async operation = add the JobKind, add a handler, and
 * call `scheduler.run(workspaceId, jobId, replicaId)`. The lifecycle
 * code stays here.
 */

import { logger } from "../lib/logger.js";
import { safeErrorMessage } from "../lib/safe-error.js";
import type { JobStore } from "./store.js";
import type { JobKind, JobRecord } from "./types.js";

/** Bump progress + refresh the lease's `leasedAt` clock. */
export type JobHeartbeat = (progress: {
	readonly processed: number;
	readonly total: number | null;
}) => void;

export interface JobHandlerArgs<TInput = unknown> {
	readonly job: JobRecord;
	readonly workspaceId: string;
	readonly jobId: string;
	readonly replicaId: string;
	/** Per-call input the caller of `scheduler.run` passed in. */
	readonly input: TInput;
	readonly heartbeat: JobHeartbeat;
}

/**
 * Per-kind handler. Returns the kind-specific result payload that
 * lands in `JobRecord.result`. Throwing is fine — the scheduler
 * catches and writes `failed` with the message.
 */
export type JobHandler<TInput = unknown> = (
	args: JobHandlerArgs<TInput>,
) => Promise<Readonly<Record<string, unknown>> | null>;

export class JobScheduler {
	// Untyped at the map level so handlers for different kinds can carry
	// different input shapes; the `run<T>()` call site is what reattaches
	// the type.
	private readonly handlers = new Map<JobKind, JobHandler<unknown>>();

	constructor(private readonly jobs: JobStore) {}

	/**
	 * Register a handler for one job kind. Throws on duplicate
	 * registration so a misconfigured scheduler fails fast at boot.
	 */
	register<TInput>(kind: JobKind, handler: JobHandler<TInput>): void {
		if (this.handlers.has(kind)) {
			throw new Error(
				`JobScheduler: handler for kind '${kind}' already registered`,
			);
		}
		this.handlers.set(kind, handler as JobHandler<unknown>);
	}

	/**
	 * Drive one job to terminal. Idempotent — a no-op for unknown,
	 * already-terminal, or unhandled-kind records.
	 *
	 * Never throws: any failure is captured into the job's
	 * `errorMessage` field with `status: "failed"`.
	 */
	async run<TInput>(
		workspaceId: string,
		jobId: string,
		replicaId: string,
		input: TInput,
	): Promise<void> {
		let job: JobRecord | null;
		try {
			job = await this.jobs.get(workspaceId, jobId);
		} catch (err) {
			logger.warn(
				{ workspace: workspaceId, jobId, err: safeErrorMessage(err) },
				"job scheduler: get(job) failed; aborting",
			);
			return;
		}
		if (!job) {
			logger.warn(
				{ workspace: workspaceId, jobId },
				"job scheduler: job not found; aborting",
			);
			return;
		}
		if (job.status === "succeeded" || job.status === "failed") {
			return;
		}

		const handler = this.handlers.get(job.kind);
		if (!handler) {
			await this.markFailed(
				workspaceId,
				jobId,
				`no handler registered for job kind '${job.kind}'`,
			);
			return;
		}

		try {
			await this.jobs.update(workspaceId, jobId, {
				status: "running",
				leasedBy: replicaId,
				leasedAt: new Date().toISOString(),
			});
			const result = await handler({
				job,
				workspaceId,
				jobId,
				replicaId,
				input,
				heartbeat: ({ processed, total }) => {
					void this.jobs
						.update(workspaceId, jobId, {
							processed,
							total,
							leasedAt: new Date().toISOString(),
						})
						.catch(() => undefined);
				},
			});
			await this.jobs.update(workspaceId, jobId, {
				status: "succeeded",
				result,
				leasedBy: null,
				leasedAt: null,
			});
		} catch (err) {
			await this.markFailed(workspaceId, jobId, safeErrorMessage(err));
		}
	}

	private async markFailed(
		workspaceId: string,
		jobId: string,
		message: string,
	): Promise<void> {
		await this.jobs
			.update(workspaceId, jobId, {
				status: "failed",
				errorMessage: safeErrorMessage(message),
				leasedBy: null,
				leasedAt: null,
			})
			.catch(() => undefined);
	}
}
