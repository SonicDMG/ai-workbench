import type { JobRecord } from "../../jobs/types.js";

/** Convert the internal job record to the public API naming convention. */
export function toWireJob(job: JobRecord) {
	return {
		workspaceId: job.workspace,
		jobId: job.jobId,
		kind: job.kind,
		knowledgeBaseId: job.knowledgeBaseId,
		documentId: job.documentId,
		status: job.status,
		processed: job.processed,
		total: job.total,
		result: job.result ? { ...job.result } : null,
		errorMessage: job.errorMessage,
		createdAt: job.createdAt,
		updatedAt: job.updatedAt,
	};
}
