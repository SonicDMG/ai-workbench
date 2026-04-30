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
import { resolveKb } from "../routes/api-v1/kb-descriptor.js";
import { JobScheduler } from "./scheduler.js";
import type { JobStore } from "./store.js";

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
 * Build a {@link JobScheduler} pre-registered with the KB-ingest
 * handler. Today this is the only handler; future kinds (reindex, bulk
 * export, …) call `register()` here too.
 */
export function buildIngestScheduler(deps: IngestWorkerDeps): JobScheduler {
	const scheduler = new JobScheduler(deps.jobs);
	scheduler.register<IngestInput>(
		"ingest",
		async ({ job, workspaceId, input, heartbeat }) => {
			if (!job.knowledgeBaseId || !job.documentId) {
				throw new Error(
					"job is missing knowledgeBaseId or documentId; cannot run kb ingest pipeline",
				);
			}
			const resolved = await resolveKb(
				deps.store,
				workspaceId,
				job.knowledgeBaseId,
			);
			const result = await runKbIngest(
				{ store: deps.store, drivers: deps.drivers, embedders: deps.embedders },
				{
					workspace: resolved.workspace,
					knowledgeBase: resolved.knowledgeBase,
					descriptor: resolved.descriptor,
					documentId: job.documentId,
				},
				input,
				(p) => heartbeat({ processed: p.processed, total: p.total }),
			);
			return { chunks: result.chunks };
		},
	);
	return scheduler;
}

/**
 * KB-ingest entry point. Builds the scheduler, registers the ingest
 * handler, and drives one job to terminal. Lease + heartbeat + error
 * capture live in {@link JobScheduler}; the only kind-specific code is
 * inside the handler above.
 */
export async function runKbIngestJob(args: IngestWorkerArgs): Promise<void> {
	const { deps, workspaceId, jobId, replicaId, input } = args;
	const scheduler = buildIngestScheduler(deps);
	await scheduler.run<IngestInput>(workspaceId, jobId, replicaId, input);
}
