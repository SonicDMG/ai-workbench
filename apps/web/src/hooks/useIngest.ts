import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
	AsyncIngestResponse,
	IngestRequest,
	JobRecord,
} from "@/lib/schemas";
import { documentQueryKey } from "./useDocuments";

/**
 * Kick off an async ingest. Returns the immediate 202 envelope
 * (`{ job, document }`); the caller typically threads `job.jobId`
 * into {@link useJobPoller} to watch it through to a terminal
 * state.
 */
export function useAsyncIngest(
	workspace: string,
	catalogId: string,
): UseMutationResult<AsyncIngestResponse, Error, IngestRequest> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.ingestAsync(workspace, catalogId, input),
		onSuccess: () => {
			// Document row materializes immediately — surface it in the
			// list even before the job terminates.
			qc.invalidateQueries({
				queryKey: documentQueryKey(workspace, catalogId),
			});
		},
	});
}

/**
 * Poll a job until it hits a terminal state (`succeeded` / `failed`).
 * When `jobId` is undefined the hook is disabled. React Query's
 * `refetchInterval` does the polling; as soon as the record reaches
 * a terminal status we return `false` to stop.
 *
 * Single-replica / in-memory job store means there's no risk of
 * losing a job across the poll window; when durable backends land
 * the same poll loop applies.
 */
export function useJobPoller(
	workspace: string | undefined,
	jobId: string | undefined,
	opts?: { intervalMs?: number },
): UseQueryResult<JobRecord, Error> {
	const intervalMs = opts?.intervalMs ?? 500;
	return useQuery({
		queryKey: ["workspaces", workspace ?? "_", "jobs", jobId ?? "_"],
		queryFn: () => {
			if (!workspace || !jobId) {
				throw new Error("useJobPoller requires workspace + jobId");
			}
			return api.getJob(workspace, jobId);
		},
		enabled: Boolean(workspace && jobId),
		refetchInterval: (query) => {
			const job = query.state.data;
			if (!job) return intervalMs;
			return job.status === "succeeded" || job.status === "failed"
				? false
				: intervalMs;
		},
	});
}
