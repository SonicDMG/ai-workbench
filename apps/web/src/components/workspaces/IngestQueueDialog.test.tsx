import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Mock `@/lib/api` before importing anything that pulls it in. The
// queue dialog uses `useAsyncIngest` (which calls `api.ingestAsync`)
// and `useJobPoller` (which calls `api.getJob`). Each test wires up
// the mock to whatever response shape it needs.
vi.mock("@/lib/api", () => ({
	api: {
		ingestAsync: vi.fn(),
		getJob: vi.fn(),
	},
	formatApiError: (err: unknown) =>
		err instanceof Error ? err.message : "Unknown error",
}));

import { api } from "@/lib/api";
import type {
	AsyncIngestResponse,
	CatalogRecord,
	JobRecord,
} from "@/lib/schemas";
import { IngestQueueDialog } from "./IngestQueueDialog";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const CATALOG: CatalogRecord = {
	workspace: "00000000-0000-4000-8000-000000000001",
	uid: "00000000-0000-4000-8000-000000000002",
	name: "kb",
	description: null,
	vectorStore: "00000000-0000-4000-8000-000000000003",
	createdAt: "2026-04-25T00:00:00.000Z",
	updatedAt: "2026-04-25T00:00:00.000Z",
};

function makeFile(name: string, content: string, type = "text/markdown"): File {
	const file = new File([content], name, { type });
	// jsdom 25's File does not implement Blob.prototype.text(); the
	// queue dialog calls it when it dequeues each file. Stub it per
	// instance so the test exercises the real flow.
	Object.defineProperty(file, "text", {
		value: () => Promise.resolve(content),
		writable: false,
	});
	return file;
}

function ingestResponse(jobId: string): AsyncIngestResponse {
	return {
		job: {
			workspace: "ws-1",
			jobId,
			kind: "ingest",
			catalogUid: CATALOG.uid,
			documentUid: `doc-${jobId}`,
			status: "pending",
			processed: 0,
			total: null,
			result: null,
			errorMessage: null,
			createdAt: "2026-04-25T00:00:00.000Z",
			updatedAt: "2026-04-25T00:00:00.000Z",
		},
		document: {
			workspace: "ws-1",
			catalogUid: CATALOG.uid,
			documentUid: `doc-${jobId}`,
			sourceDocId: null,
			sourceFilename: "f.md",
			fileType: "text/markdown",
			fileSize: 0,
			md5Hash: null,
			chunkTotal: null,
			ingestedAt: null,
			updatedAt: "2026-04-25T00:00:00.000Z",
			status: "writing",
			errorMessage: null,
			metadata: {},
		},
	};
}

function jobRecord(
	jobId: string,
	status: JobRecord["status"],
	overrides?: Partial<JobRecord>,
): JobRecord {
	return {
		workspace: "ws-1",
		jobId,
		kind: "ingest",
		catalogUid: CATALOG.uid,
		documentUid: `doc-${jobId}`,
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
				catalog={CATALOG}
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
		// Each ingest returns its own jobId; each subsequent getJob
		// resolves to a `succeeded` snapshot so the queue advances.
		// If the poll-snapshot effect were to spin (the bug we just
		// fixed), `getJob` would be called orders-of-magnitude more
		// often than the queue length suggests — the assertion below
		// pins the call count to the queue length.
		vi.mocked(api.ingestAsync)
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
				catalog={CATALOG}
				open
				onOpenChange={() => {}}
			/>,
			{ wrapper },
		);

		// Drop three supported files via the hidden file input. We bypass
		// the drag-drop affordance so we don't depend on jsdom's
		// DragEvent which is half-implemented.
		const fileInput = document.querySelector(
			'input[type="file"]:not([webkitdirectory])',
		) as HTMLInputElement;
		expect(fileInput).toBeTruthy();
		await user.upload(fileInput, [
			makeFile("a.md", "alpha"),
			makeFile("b.md", "beta"),
			makeFile("c.md", "gamma"),
		]);

		// Pre-flight: the three items should be queued before we hit Start.
		await waitFor(() => {
			expect(screen.getByText("a.md")).toBeInTheDocument();
			expect(screen.getByText("b.md")).toBeInTheDocument();
			expect(screen.getByText("c.md")).toBeInTheDocument();
		});

		// Start the drain.
		await user.click(screen.getByRole("button", { name: /Start ingest/ }));

		// Each row eventually flips to "succeeded".
		await waitFor(
			() => {
				expect(api.ingestAsync).toHaveBeenCalledTimes(3);
				expect(screen.queryAllByText(/5 chunks/).length).toBe(3);
			},
			{ timeout: 5_000 },
		);

		// Bug guard: if the poll effect were spinning on activeItem ref
		// churn, getJob would fire dozens of times per row before the
		// terminal transition. With the fix, each row's poller fires
		// O(1) times before terminal — bound generously at 6 per row.
		expect(vi.mocked(api.getJob).mock.calls.length).toBeLessThan(20);
	});

	it("kicks exactly one ingest per file even while the mutation stays pending", async () => {
		// Regression for the "8 duplicate Document rows from one CSV"
		// bug. `useMutation`'s return object changes ref when
		// `isPending` flips false → true; including `ingest` in the
		// drain effect's deps caused the effect to re-fire mid-await
		// (before `setActiveId` had run) and kick the same file
		// again — on every re-render until React bailed with #185.
		// We hold the mutation pending here so the bug, if present,
		// would surface as N>1 ingest calls.
		const resolvers: Array<(res: AsyncIngestResponse) => void> = [];
		vi.mocked(api.ingestAsync).mockImplementation(
			() =>
				new Promise<AsyncIngestResponse>((resolve) => {
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
				catalog={CATALOG}
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

		// Let React settle a few times so any re-entry has a chance
		// to fire. Without the fix the effect double-kicks during
		// mutation pending.
		await new Promise((r) => setTimeout(r, 100));

		expect(api.ingestAsync).toHaveBeenCalledTimes(1);

		// Resolve to reach a terminal state and clean up the test.
		resolvers[0]?.(ingestResponse("job-1"));
		await waitFor(() =>
			expect(screen.getByText(/5 chunks/)).toBeInTheDocument(),
		);
	});

	it("captures a non-Error mutation rejection as 'Unknown error' on the failed row, not as a crash", async () => {
		// The user-reported "unknown error" symptom: ingest.mutateAsync
		// rejects with something formatApiError can't unwrap. The queue
		// must keep going — the failure belongs to that row, not the
		// dialog.
		vi.mocked(api.ingestAsync)
			.mockRejectedValueOnce("string-not-an-error" as unknown as Error)
			.mockResolvedValueOnce(ingestResponse("job-2"));
		vi.mocked(api.getJob).mockImplementation(async (_ws, jobId) =>
			jobRecord(jobId, "succeeded"),
		);

		const user = userEvent.setup();
		render(
			<IngestQueueDialog
				workspace="ws-1"
				catalog={CATALOG}
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
		// Both files were popped off the queue: one failed, one succeeded.
		expect(api.ingestAsync).toHaveBeenCalledTimes(2);
	});
});
