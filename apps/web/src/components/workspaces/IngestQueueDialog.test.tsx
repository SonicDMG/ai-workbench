import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Mock `@/lib/api` before importing anything that pulls it in.
vi.mock("@/lib/api", () => ({
	api: {
		kbIngestFileAsync: vi.fn(),
		getJob: vi.fn(),
	},
	formatApiError: (err: unknown) =>
		err instanceof Error ? err.message : "Unknown error",
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	},
}));

import { toast } from "sonner";
import { api } from "@/lib/api";
import type {
	JobRecord,
	KbAsyncIngestResponse,
	KbIngestDuplicateResponse,
	KbIngestNameConflictResponse,
	KnowledgeBaseRecord,
} from "@/lib/schemas";
import { IngestQueueDialog } from "./IngestQueueDialog";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const KB: KnowledgeBaseRecord = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	knowledgeBaseId: "00000000-0000-4000-8000-000000000002",
	name: "kb",
	description: null,
	status: "active",
	embeddingServiceId: "00000000-0000-4000-8000-000000000003",
	chunkingServiceId: "00000000-0000-4000-8000-000000000004",
	rerankingServiceId: null,
	language: null,
	vectorCollection: "wb_vectors_kb",
	owned: true,
	lexical: { enabled: false, analyzer: null, options: {} },
	policyDsl: null,
	policyEnabled: false,
	createdAt: "2026-04-25T00:00:00.000Z",
	updatedAt: "2026-04-25T00:00:00.000Z",
};

function makeFile(name: string, content: string, type = "text/markdown"): File {
	const file = new File([content], name, { type });
	Object.defineProperty(file, "text", {
		value: () => Promise.resolve(content),
		writable: false,
	});
	return file;
}

function ingestResponse(jobId: string): KbAsyncIngestResponse {
	return {
		job: {
			workspaceId: "ws-1",
			jobId,
			kind: "ingest",
			knowledgeBaseId: KB.knowledgeBaseId,
			documentId: `doc-${jobId}`,
			status: "pending",
			processed: 0,
			total: null,
			result: null,
			errorMessage: null,
			createdAt: "2026-04-25T00:00:00.000Z",
			updatedAt: "2026-04-25T00:00:00.000Z",
		},
		document: {
			workspaceId: "ws-1",
			knowledgeBaseId: KB.knowledgeBaseId,
			documentId: `doc-${jobId}`,
			sourceDocId: null,
			sourceFilename: "f.md",
			fileType: "text/markdown",
			fileSize: 0,
			contentHash: null,
			chunkTotal: null,
			ingestedAt: null,
			updatedAt: "2026-04-25T00:00:00.000Z",
			status: "writing",
			errorMessage: null,
			metadata: {},
			visibleTo: null,
			ownerPrincipalId: null,
		},
		astraQueries: [],
	};
}

function duplicateResponse(
	documentId: string,
	chunkTotal = 7,
): KbIngestDuplicateResponse {
	return {
		outcome: "duplicate",
		document: {
			workspaceId: "ws-1",
			knowledgeBaseId: KB.knowledgeBaseId,
			documentId,
			sourceDocId: null,
			sourceFilename: "f.md",
			fileType: "text/markdown",
			fileSize: 0,
			contentHash:
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			chunkTotal,
			ingestedAt: "2026-04-25T00:00:00.000Z",
			updatedAt: "2026-04-25T00:00:00.000Z",
			status: "ready",
			errorMessage: null,
			metadata: {},
			visibleTo: null,
			ownerPrincipalId: null,
		},
	};
}

function nameConflictResponse(
	documentId: string,
	chunkTotal = 5,
): KbIngestNameConflictResponse {
	return {
		outcome: "name_conflict",
		document: {
			workspaceId: "ws-1",
			knowledgeBaseId: KB.knowledgeBaseId,
			documentId,
			sourceDocId: null,
			sourceFilename: "policy.md",
			fileType: "text/markdown",
			fileSize: 0,
			contentHash:
				"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
			chunkTotal,
			ingestedAt: "2026-04-25T00:00:00.000Z",
			updatedAt: "2026-04-25T00:00:00.000Z",
			status: "ready",
			errorMessage: null,
			metadata: {},
			visibleTo: null,
			ownerPrincipalId: null,
		},
	};
}

function jobRecord(
	jobId: string,
	status: JobRecord["status"],
	overrides?: Partial<JobRecord>,
): JobRecord {
	return {
		workspaceId: "ws-1",
		jobId,
		kind: "ingest",
		knowledgeBaseId: KB.knowledgeBaseId,
		documentId: `doc-${jobId}`,
		status,
		processed: status === "succeeded" ? 5 : 0,
		total: status === "pending" ? null : 5,
		result: status === "succeeded" ? { chunks: 5 } : null,
		errorMessage: null,
		createdAt: "2026-04-25T00:00:00.000Z",
		updatedAt: "2026-04-25T00:00:00.000Z",
		...overrides,
	};
}

describe("IngestQueueDialog", () => {
	it("queues Markdown, YAML, config, and source files even when MIME is empty", async () => {
		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [
			makeFile("notes.md", "hello", ""),
			makeFile("config.yaml", "name: workbench", ""),
			makeFile("settings.ini", "[main]", ""),
			makeFile("main.ts", "export {}", ""),
		]);

		await waitFor(() => {
			expect(screen.getByText("notes.md")).toBeInTheDocument();
			expect(screen.getByText("config.yaml")).toBeInTheDocument();
			expect(screen.getByText("settings.ini")).toBeInTheDocument();
			expect(screen.getByText("main.ts")).toBeInTheDocument();
		});
	});

	it("processes a queue of three files end-to-end without re-render storms", async () => {
		vi.mocked(api.kbIngestFileAsync)
			.mockResolvedValueOnce(ingestResponse("job-1"))
			.mockResolvedValueOnce(ingestResponse("job-2"))
			.mockResolvedValueOnce(ingestResponse("job-3"));
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobRecord(jobId, "succeeded"),
		);

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [
			makeFile("a.md", "alpha"),
			makeFile("b.md", "beta"),
			makeFile("c.md", "gamma"),
		]);

		await waitFor(() => {
			expect(screen.getByText("a.md")).toBeInTheDocument();
			expect(screen.getByText("b.md")).toBeInTheDocument();
			expect(screen.getByText("c.md")).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		await waitFor(
			() => {
				expect(api.kbIngestFileAsync).toHaveBeenCalledTimes(3);
				expect(screen.queryAllByText(/5 chunks/).length).toBe(3);
			},
			{ timeout: 5_000 },
		);

		// Bug guard from the original storm regression — same upper bound.
		expect(vi.mocked(api.getJob).mock.calls.length).toBeLessThan(20);
	});

	it("toasts and requests close after every queued file reaches a clean terminal state", async () => {
		vi.mocked(api.kbIngestFileAsync)
			.mockResolvedValueOnce(ingestResponse("job-1"))
			.mockResolvedValueOnce(duplicateResponse("dup-doc-1", 7));
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobRecord(jobId, "succeeded"),
		);
		const onOpenChange = vi.fn();

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={onOpenChange}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [
			makeFile("fresh.md", "fresh body"),
			makeFile("dup.md", "duplicate body"),
		]);
		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		await waitFor(() => {
			expect(toast.success).toHaveBeenCalledWith("Ingest complete", {
				description: "1 ingested, 1 skipped",
			});
		});
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), {
			timeout: 3_000,
		});
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("kicks exactly one ingest per file even while the mutation stays pending", async () => {
		const resolvers: Array<(res: KbAsyncIngestResponse) => void> = [];
		vi.mocked(api.kbIngestFileAsync).mockImplementation(
			() =>
				new Promise<KbAsyncIngestResponse>((resolve) => {
					resolvers.push(resolve);
				}),
		);
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobRecord(jobId, "succeeded"),
		);

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [makeFile("only.csv", "row1\nrow2")]);
		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		await new Promise((r) => setTimeout(r, 100));

		expect(api.kbIngestFileAsync).toHaveBeenCalledTimes(1);

		resolvers[0]?.(ingestResponse("job-1"));
		await waitFor(() =>
			expect(screen.getByText(/5 chunks/)).toBeInTheDocument(),
		);
	});

	it("marks duplicate-content responses as skipped without polling getJob", async () => {
		// First file dedupes (server returns 200 + outcome:duplicate), second
		// runs a normal ingest. The skipped row must reach a terminal state
		// without ever calling getJob, and the queue must continue to drain
		// on to the next file.
		vi.mocked(api.kbIngestFileAsync)
			.mockResolvedValueOnce(duplicateResponse("dup-doc-1", 7))
			.mockResolvedValueOnce(ingestResponse("job-2"));
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobRecord(jobId, "succeeded"),
		);

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [
			makeFile("dup.md", "duplicate body"),
			makeFile("fresh.md", "fresh body"),
		]);
		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		await waitFor(() => {
			expect(screen.getByText(/already ingested/i)).toBeInTheDocument();
			expect(screen.getByText(/5 chunks/)).toBeInTheDocument();
		});
		expect(screen.getByText(/1 done, 1 skipped/)).toBeInTheDocument();
		// Crucially: duplicate path must NOT poll a job. Only the second
		// (fresh) ingest should drive getJob.
		const dupCalls = vi
			.mocked(api.getJob)
			.mock.calls.filter(([, jobId]) => jobId === "dup-doc-1");
		expect(dupCalls).toHaveLength(0);
	});

	it("surfaces the overwrite prompt on a name_conflict, retries with overwriteOnNameConflict=true on Overwrite", async () => {
		// Initial ingest call returns 200 name_conflict; the prompt
		// modal pops up. User clicks Overwrite — the queue re-issues
		// the ingest with `overwriteOnNameConflict: true` and the
		// retry succeeds (simulated as a normal queued ingest).
		vi.mocked(api.kbIngestFileAsync)
			.mockResolvedValueOnce(nameConflictResponse("existing-doc-1"))
			.mockResolvedValueOnce(ingestResponse("job-after-overwrite"));
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobRecord(jobId, "succeeded"),
		);

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [makeFile("policy.md", "v2 content")]);
		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		// Modal appears with the conflicted filename.
		await waitFor(() =>
			expect(screen.getByText(/Replace "policy.md"\?/)).toBeInTheDocument(),
		);

		await user.click(screen.getByRole("button", { name: "Overwrite" }));

		await waitFor(() =>
			expect(screen.getByText(/5 chunks/)).toBeInTheDocument(),
		);

		// Two ingest calls: the initial probe (no flag) and the retry
		// with overwriteOnNameConflict=true.
		expect(api.kbIngestFileAsync).toHaveBeenCalledTimes(2);
		const firstCall = vi.mocked(api.kbIngestFileAsync).mock.calls[0];
		const secondCall = vi.mocked(api.kbIngestFileAsync).mock.calls[1];
		expect(firstCall?.[2]?.overwriteOnNameConflict).toBeUndefined();
		expect(secondCall?.[2]?.overwriteOnNameConflict).toBe(true);
	});

	it("marks the row as skipped and continues to the next file when the user picks Skip on a name_conflict", async () => {
		// First file conflicts → user picks Skip (no remember). Second
		// file is unrelated and ingests normally. The queue must reach
		// "1 done, 1 skipped" without ever calling kbIngestFileAsync a
		// third time (no retry on Skip).
		vi.mocked(api.kbIngestFileAsync)
			.mockResolvedValueOnce(nameConflictResponse("existing-doc-1"))
			.mockResolvedValueOnce(ingestResponse("job-2"));
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobRecord(jobId, "succeeded"),
		);

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [
			makeFile("policy.md", "v2"),
			makeFile("other.md", "fresh"),
		]);
		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		await waitFor(() =>
			expect(screen.getByText(/Replace "policy.md"\?/)).toBeInTheDocument(),
		);

		await user.click(screen.getByRole("button", { name: "Skip" }));

		await waitFor(() => {
			expect(screen.getByText(/1 done, 1 skipped/)).toBeInTheDocument();
		});
		// No retry on Skip — only the initial probe + the second file's
		// ingest.
		expect(api.kbIngestFileAsync).toHaveBeenCalledTimes(2);
	});

	it("auto-applies subsequent name_conflicts when 'Apply this choice' is checked", async () => {
		// Three files all hit name_conflict. User checks "apply to
		// all" + clicks Overwrite on the first prompt. The remaining
		// two files must auto-overwrite without surfacing the modal
		// again. Final mutation count: 3 probes + 3 overwrite retries
		// = 6.
		vi.mocked(api.kbIngestFileAsync)
			.mockResolvedValueOnce(nameConflictResponse("existing-1"))
			.mockResolvedValueOnce(ingestResponse("job-1"))
			.mockResolvedValueOnce(nameConflictResponse("existing-2"))
			.mockResolvedValueOnce(ingestResponse("job-2"))
			.mockResolvedValueOnce(nameConflictResponse("existing-3"))
			.mockResolvedValueOnce(ingestResponse("job-3"));
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobRecord(jobId, "succeeded"),
		);

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [
			makeFile("a.md", "v2-a"),
			makeFile("b.md", "v2-b"),
			makeFile("c.md", "v2-c"),
		]);
		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		// First conflict modal — user opts in to remembering.
		await waitFor(() =>
			expect(
				screen.getByText(/A document with the same name already exists/i),
			).toBeInTheDocument(),
		);
		await user.click(
			screen.getByLabelText(/Apply this choice to other name conflicts/i),
		);
		await user.click(screen.getByRole("button", { name: "Overwrite" }));

		await waitFor(() => {
			// 3 done, 0 skipped, 0 failed.
			expect(screen.getByText(/3 files queued — 3 done/)).toBeInTheDocument();
		});

		expect(api.kbIngestFileAsync).toHaveBeenCalledTimes(6);
		// Modal must NOT have re-opened for the second/third files.
		expect(screen.queryByText(/Replace "b\.md"/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Replace "c\.md"/)).not.toBeInTheDocument();
	});

	it("kicks the next file while earlier jobs are still running (parallel drain, #360)", async () => {
		// Three files; every job stays in `running` forever. The old
		// single-active design would kick file 1 and then stall until
		// its job succeeded — files 2 and 3 would never submit. The
		// bounded-parallel drain must submit all three (default limit
		// is 4) even though none of the jobs have completed.
		vi.mocked(api.kbIngestFileAsync)
			.mockResolvedValueOnce(ingestResponse("job-1"))
			.mockResolvedValueOnce(ingestResponse("job-2"))
			.mockResolvedValueOnce(ingestResponse("job-3"));
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobRecord(jobId, "running"),
		);

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [
			makeFile("a.md", "alpha"),
			makeFile("b.md", "beta"),
			makeFile("c.md", "gamma"),
		]);
		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		await waitFor(
			() => expect(api.kbIngestFileAsync).toHaveBeenCalledTimes(3),
			{ timeout: 5_000 },
		);
	});

	it("respects a parallel limit of 1: the second file waits for the first job to finish", async () => {
		// Drop the picker to 1 (legacy sequential behavior). With job-1
		// parked in `running`, file 2 must NOT submit; once job-1
		// succeeds, file 2 submits.
		let job1Done = false;
		vi.mocked(api.kbIngestFileAsync)
			.mockResolvedValueOnce(ingestResponse("job-1"))
			.mockResolvedValueOnce(ingestResponse("job-2"));
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobId === "job-1" && !job1Done
				? jobRecord(jobId, "running")
				: jobRecord(jobId, "succeeded"),
		);

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [
			makeFile("a.md", "alpha"),
			makeFile("b.md", "beta"),
		]);

		await user.selectOptions(screen.getByLabelText(/Parallel ingests/), "1");
		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		await waitFor(() => expect(api.kbIngestFileAsync).toHaveBeenCalledTimes(1));
		// Give the drain a beat: file 2 must still be parked behind the
		// limit while job-1 runs.
		await new Promise((r) => setTimeout(r, 700));
		expect(api.kbIngestFileAsync).toHaveBeenCalledTimes(1);

		job1Done = true;
		await waitFor(
			() => expect(api.kbIngestFileAsync).toHaveBeenCalledTimes(2),
			{ timeout: 5_000 },
		);
	});

	it("captures a non-Error mutation rejection as 'Unknown error' on the failed row, not as a crash", async () => {
		vi.mocked(api.kbIngestFileAsync)
			.mockRejectedValueOnce("string-not-an-error" as unknown as Error)
			.mockResolvedValueOnce(ingestResponse("job-2"));
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobRecord(jobId, "succeeded"),
		);

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				knowledgeBase={KB}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		await user.upload(fileInput, [
			makeFile("a.md", "alpha"),
			makeFile("b.md", "beta"),
		]);
		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		await waitFor(() => {
			expect(screen.getByText(/Unknown error/)).toBeInTheDocument();
			expect(screen.getByText(/5 chunks/)).toBeInTheDocument();
		});
		expect(api.kbIngestFileAsync).toHaveBeenCalledTimes(2);
	});
});
