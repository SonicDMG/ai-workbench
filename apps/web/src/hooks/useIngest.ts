import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
	JobRecord,
	KbAsyncIngestResponse,
	KbIngestRequest,
} from "@/lib/schemas";
import { documentQueryKey } from "./useDocuments";

/**
 * Kick off an async ingest into a knowledge base. Returns the
 * immediate 202 envelope (`{ job, document }`); the caller threads
 * `job.jobId` into {@link useJobPoller} to watch through to a
 * terminal state.
 */
export function useAsyncIngest(
	workspaceUid: string,
	kbUid: string,
): UseMutationResult<KbAsyncIngestResponse, Error, KbIngestRequest> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.kbIngestAsync(workspaceUid, kbUid, input),
		onSuccess: () => {
			qc.invalidateQueries({
				queryKey: documentQueryKey(workspaceUid, kbUid),
			});
		},
	});
}

/**
 * Poll a job until it hits a terminal state (`succeeded` / `failed`).
 */
export function useJobPoller(
	workspaceUid: string | undefined,
	jobId: string | undefined,
	opts?: { intervalMs?: number },
): UseQueryResult<JobRecord, Error> {
	const intervalMs = opts?.intervalMs ?? 500;
	return useQuery({
		queryKey: ["workspaces", workspaceUid ?? "_", "jobs", jobId ?? "_"],
		queryFn: () => {
			if (!workspaceUid || !jobId) {
				throw new Error("useJobPoller requires workspaceUid + jobId");
			}
			return api.getJob(workspaceUid, jobId);
		},
		enabled: Boolean(workspaceUid && jobId),
		refetchInterval: (query) => {
			const job = query.state.data;
			if (!job) return intervalMs;
			return job.status === "succeeded" || job.status === "failed"
				? false
				: intervalMs;
		},
	});
}
