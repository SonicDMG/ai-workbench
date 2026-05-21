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
	KbIngestAsyncOrDuplicate,
	KbIngestRequest,
} from "@/lib/schemas";
import { documentQueryKey } from "./useDocuments";

/**
 * Kick off an async ingest into a knowledge base. Returns either the
 * 202 envelope (`{ job, document }`) for fresh content or the dedup
 * 200 envelope (`{ document, outcome: "duplicate" }`) when the body
 * matches an existing document by SHA-256 hash. Callers thread
 * `job.jobId` into {@link useJobPoller} for the live-progress case;
 * for the duplicate case there's no job to poll.
 */
export function useAsyncIngest(
	workspaceId: string,
	kbId: string,
): UseMutationResult<KbIngestAsyncOrDuplicate, Error, KbIngestRequest> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.kbIngestAsync(workspaceId, kbId, input),
		onSuccess: () => {
			qc.invalidateQueries({
				queryKey: documentQueryKey(workspaceId, kbId),
			});
		},
	});
}

export interface AsyncIngestFileInput {
	readonly file: File;
	readonly filename: string;
	readonly parser?: "auto" | "native" | "docling";
	readonly metadata?: Readonly<Record<string, string>>;
	readonly overwriteOnNameConflict?: boolean;
	/** RLAC: principal ids (or `"*"`) that may read this doc. */
	readonly visibleTo?: readonly string[];
	/** RLAC: provenance only. */
	readonly ownerPrincipalId?: string;
}

/**
 * Multipart variant of {@link useAsyncIngest} — uploads a `File`
 * (PDF / DOCX / text) and lets the server extract plain text before
 * the chunk + embed pipeline runs. Same response envelope, same
 * cache-invalidation behavior; the only difference is the wire
 * format.
 */
export function useAsyncIngestFile(
	workspaceId: string,
	kbId: string,
): UseMutationResult<KbIngestAsyncOrDuplicate, Error, AsyncIngestFileInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.kbIngestFileAsync(workspaceId, kbId, input),
		onSuccess: () => {
			qc.invalidateQueries({
				queryKey: documentQueryKey(workspaceId, kbId),
			});
		},
	});
}

/**
 * Poll a job until it hits a terminal state (`succeeded` / `failed`).
 *
 * `refetchIntervalInBackground: true` keeps the poller alive when the
 * browser tab is unfocused. Without it, TanStack Query suspends the
 * interval on blur, which stalls the {@link IngestQueueDialog} drain
 * loop — it only advances to the next file when the poller observes a
 * terminal status, so the entire queue freezes until the user refocuses
 * the tab. A KB ingest can take many minutes; users routinely switch
 * tabs and don't expect progress to halt.
 */
export function useJobPoller(
	workspaceId: string | undefined,
	jobId: string | undefined,
	opts?: { intervalMs?: number },
): UseQueryResult<JobRecord, Error> {
	const intervalMs = opts?.intervalMs ?? 500;
	return useQuery({
		queryKey: ["workspaces", workspaceId ?? "_", "jobs", jobId ?? "_"],
		queryFn: () => {
			if (!workspaceId || !jobId) {
				throw new Error("useJobPoller requires workspaceId + jobId");
			}
			return api.getJob(workspaceId, jobId);
		},
		enabled: Boolean(workspaceId && jobId),
		refetchInterval: (query) => {
			const job = query.state.data;
			if (!job) return intervalMs;
			return job.status === "succeeded" || job.status === "failed"
				? false
				: intervalMs;
		},
		refetchIntervalInBackground: true,
	});
}
