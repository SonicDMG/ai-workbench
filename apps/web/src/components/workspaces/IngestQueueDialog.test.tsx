import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Mock `@/lib/api` before importing anything that pulls it in.
vi.mock("@/lib/api", () => ({
	api: {
		kbIngestAsync: vi.fn(),
		getJob: vi.fn(),
	},
	formatApiError: (err: unknown) =>
		err instanceof Error ? err.message : "Unknown error",
}));

import { api } from "@/lib/api";
import type {
	JobRecord,
	KbAsyncIngestResponse,
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
	lexical: { enabled: false, analyzer: null, options: {} },
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
			workspace: "ws-1",
			jobId,
			kind: "ingest",
			knowledgeBaseUid: KB.knowledgeBaseId,
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
		knowledgeBaseUid: KB.knowledgeBaseId,
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
		vi.mocked(api.kbIngestAsync)
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
				expect(api.kbIngestAsync).toHaveBeenCalledTimes(3);
				expect(screen.queryAllByText(/5 chunks/).length).toBe(3);
			},
			{ timeout: 5_000 },
		);

		// Bug guard from the original storm regression — same upper bound.
		expect(vi.mocked(api.getJob).mock.calls.length).toBeLessThan(20);
	});

	it("kicks exactly one ingest per file even while the mutation stays pending", async () => {
		const resolvers: Array<(res: KbAsyncIngestResponse) => void> = [];
		vi.mocked(api.kbIngestAsync).mockImplementation(
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

		expect(api.kbIngestAsync).toHaveBeenCalledTimes(1);

		resolvers[0]?.(ingestResponse("job-1"));
		await waitFor(() =>
			expect(screen.getByText(/5 chunks/)).toBeInTheDocument(),
		);
	});

	it("captures a non-Error mutation rejection as 'Unknown error' on the failed row, not as a crash", async () => {
		vi.mocked(api.kbIngestAsync)
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
		expect(api.kbIngestAsync).toHaveBeenCalledTimes(2);
	});
});
