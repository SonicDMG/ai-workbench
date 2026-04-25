/**
 * Shared async-ingest worker.
 *
 * Both the route handler (`POST /catalogs/{c}/ingest?async=true`) and
 * the cross-replica orphan sweeper drive the ingest pipeline through
 * this function. Centralizing the lifecycle (claim → run → terminal +
 * heartbeats) keeps the two callers from drifting on what counts as a
 * "completed job."
 *
 * The function never throws: any error is captured into the job
 * record's `errorMessage` with a `failed` terminal state. Callers
 * spawn it with `void` and rely on the job-status update for
 * outcomes.
 */

import type { ControlPlaneStore } from "../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import type { IngestInput } from "../ingest/pipeline.js";
import { runIngest } from "../ingest/pipeline.js";
import { logger } from "../lib/logger.js";
import type { JobStore } from "./store.js";
import type { JobRecord } from "./types.js";

export interface IngestWorkerDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly jobs: JobStore;
}

export interface IngestWorkerArgs {
	readonly deps: IngestWorkerDeps;
	readonly workspaceId: string;
	readonly jobId: string;
	readonly replicaId: string;
	/**
	 * Original ingest input (text, metadata, chunker opts). Required —
	 * the resume path reads this back from the job row, the create
	 * path passes it inline. Both routes ultimately go through this
	 * single seam.
	 */
	readonly input: IngestInput;
}

/**
 * Drive the ingest pipeline for one job to terminal state.
 *
 * Re-derives the `IngestContext` from the job's `catalogUid` /
 * `documentUid` so the sweeper can call this with just a workspace +
 * jobId. Stamps `leasedBy = replicaId` on entry, heartbeats on every
 * progress tick, and clears the lease on terminal.
 *
 * Already-`succeeded` and already-`failed` jobs short-circuit — the
 * sweeper might re-claim a job whose previous worker actually
 * finished but couldn't update the row before dying. Idempotent
 * resume guarantees we never flip a terminal job back to running.
 */
export async function runIngestJob(args: IngestWorkerArgs): Promise<void> {
	const { deps, workspaceId, jobId, replicaId, input } = args;
	const { store, drivers, embedders, jobs } = deps;

	let job: JobRecord | null;
	try {
		job = await jobs.get(workspaceId, jobId);
	} catch (err) {
		logger.warn(
			{
				workspace: workspaceId,
				jobId,
				err: err instanceof Error ? err.message : String(err),
			},
			"ingest worker: get(job) failed; aborting",
		);
		return;
	}
	if (!job) {
		logger.warn(
			{ workspace: workspaceId, jobId },
			"ingest worker: job not found; aborting",
		);
		return;
	}
	if (job.status === "succeeded" || job.status === "failed") {
		// Terminal already — refuse to flip backwards.
		return;
	}
	if (!job.catalogUid || !job.documentUid) {
		await failJob(
			jobs,
			workspaceId,
			jobId,
			"job is missing catalogUid or documentUid; cannot run ingest pipeline",
		);
		return;
	}

	const workspace = await store.getWorkspace(workspaceId);
	const catalog = workspace
		? await store.getCatalog(workspaceId, job.catalogUid)
		: null;
	if (!workspace || !catalog) {
		await failJob(
			jobs,
			workspaceId,
			jobId,
			"workspace or catalog no longer exists; cannot run ingest pipeline",
		);
		return;
	}
	if (!catalog.vectorStore) {
		await failJob(
			jobs,
			workspaceId,
			jobId,
			`catalog '${catalog.uid}' has no vectorStore binding`,
		);
		return;
	}
	const descriptor = await store.getVectorStore(
		workspaceId,
		catalog.vectorStore,
	);
	if (!descriptor) {
		await failJob(
			jobs,
			workspaceId,
			jobId,
			`bound vector store '${catalog.vectorStore}' no longer exists`,
		);
		return;
	}

	try {
		await jobs.update(workspaceId, jobId, {
			status: "running",
			leasedBy: replicaId,
			leasedAt: new Date().toISOString(),
		});
		const result = await runIngest(
			{ store, drivers, embedders },
			{ workspace, catalog, descriptor, documentUid: job.documentUid },
			input,
			(p) => {
				void jobs
					.update(workspaceId, jobId, {
						processed: p.processed,
						total: p.total,
						leasedAt: new Date().toISOString(),
					})
					.catch(() => undefined);
			},
		);
		await jobs.update(workspaceId, jobId, {
			status: "succeeded",
			result: { chunks: result.chunks },
			leasedBy: null,
			leasedAt: null,
		});
	} catch (err) {
		await jobs
			.update(workspaceId, jobId, {
				status: "failed",
				errorMessage: err instanceof Error ? err.message : String(err),
				leasedBy: null,
				leasedAt: null,
			})
			.catch(() => undefined);
	}
}

async function failJob(
	jobs: JobStore,
	workspaceId: string,
	jobId: string,
	message: string,
): Promise<void> {
	await jobs
		.update(workspaceId, jobId, {
			status: "failed",
			errorMessage: message,
			leasedBy: null,
			leasedAt: null,
		})
		.catch(() => undefined);
}
