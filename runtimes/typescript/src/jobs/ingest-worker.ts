/**
 * Shared async-ingest worker.
 *
 * Both the route handler (`POST /knowledge-bases/{kb}/ingest?async=true`)
 * and the cross-replica orphan sweeper drive the ingest pipeline
 * through this function. Centralizing the lifecycle (claim → run →
 * terminal + heartbeats) keeps the two callers from drifting on what
 * counts as a "completed job."
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
import { runKbIngest } from "../ingest/pipeline.js";
import { logger } from "../lib/logger.js";
import { safeErrorMessage } from "../lib/safe-error.js";
import { resolveKb } from "../routes/api-v1/kb-descriptor.js";
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

async function failJob(
	jobs: JobStore,
	workspaceId: string,
	jobId: string,
	message: string,
): Promise<void> {
	await jobs
		.update(workspaceId, jobId, {
			status: "failed",
			errorMessage: safeErrorMessage(message),
			leasedBy: null,
			leasedAt: null,
		})
		.catch(() => undefined);
}

/**
 * KB-scoped sibling of {@link runIngestJob}. Drives the KB ingest
 * pipeline for one job to terminal state; resolves the KB descriptor
 * on each call so the sweeper can revive jobs whose schema was
 * mutated mid-flight (e.g. KB renamed or its embedding service
 * patched). Same lease + heartbeat semantics as the catalog path.
 */
export async function runKbIngestJob(args: IngestWorkerArgs): Promise<void> {
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
			"kb ingest worker: get(job) failed; aborting",
		);
		return;
	}
	if (!job) {
		logger.warn(
			{ workspace: workspaceId, jobId },
			"kb ingest worker: job not found; aborting",
		);
		return;
	}
	if (job.status === "succeeded" || job.status === "failed") {
		return;
	}
	if (!job.knowledgeBaseId || !job.documentId) {
		await failJob(
			jobs,
			workspaceId,
			jobId,
			"job is missing knowledgeBaseId or documentId; cannot run kb ingest pipeline",
		);
		return;
	}

	let resolved: Awaited<ReturnType<typeof resolveKb>>;
	try {
		resolved = await resolveKb(store, workspaceId, job.knowledgeBaseId);
	} catch (err) {
		await failJob(
			jobs,
			workspaceId,
			jobId,
			`kb resolution failed: ${safeErrorMessage(err)}`,
		);
		return;
	}

	try {
		await jobs.update(workspaceId, jobId, {
			status: "running",
			leasedBy: replicaId,
			leasedAt: new Date().toISOString(),
		});
		const result = await runKbIngest(
			{ store, drivers, embedders },
			{
				workspace: resolved.workspace,
				knowledgeBase: resolved.knowledgeBase,
				descriptor: resolved.descriptor,
				documentId: job.documentId,
			},
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
				errorMessage: safeErrorMessage(err),
				leasedBy: null,
				leasedAt: null,
			})
			.catch(() => undefined);
	}
}
