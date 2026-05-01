import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentChunk, RagDocumentRecord } from "@/lib/schemas";

type ChunksState = {
	data: DocumentChunk[] | undefined;
	error: Error | null;
	isLoading: boolean;
	isError: boolean;
};

const chunksState: ChunksState = {
	data: undefined,
	error: null,
	isLoading: false,
	isError: false,
};

vi.mock("@/hooks/useDocuments", () => ({
	useDocumentChunks: () => ({
		data: chunksState.data,
		error: chunksState.error,
		isLoading: chunksState.isLoading,
		isError: chunksState.isError,
	}),
}));

import { DocumentDetailDialog } from "./DocumentDetailDialog";

function makeDoc(
	overrides: Partial<RagDocumentRecord> = {},
): RagDocumentRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		knowledgeBaseId: "00000000-0000-4000-8000-000000000002",
		documentId: "00000000-0000-4000-8000-000000000003",
		sourceDocId: null,
		sourceFilename: "alpha.md",
		fileType: "text/markdown",
		fileSize: 2048,
		contentHash: "sha256:abc",
		chunkTotal: 3,
		ingestedAt: "2026-04-25T10:00:00.000Z",
		updatedAt: "2026-04-25T11:00:00.000Z",
		status: "ready",
		errorMessage: null,
		metadata: {},
		...overrides,
	};
}

beforeEach(() => {
	chunksState.data = undefined;
	chunksState.error = null;
	chunksState.isLoading = false;
	chunksState.isError = false;
});

describe("DocumentDetailDialog", () => {
	it("renders nothing visible when doc is null (dialog closed)", () => {
		const { container } = render(
			<DocumentDetailDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={null}
				onOpenChange={() => {}}
			/>,
		);
		// Dialog uses a portal, but without a doc the title fallback
		// "Document" should not be in the document because the dialog
		// is closed.
		expect(container.querySelector("[role='dialog']")).toBeNull();
	});

	it("renders doc metadata, source filename, and KV pairs for a ready doc", () => {
		chunksState.data = [];
		render(
			<DocumentDetailDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc({
					sourceFilename: "alpha.md",
					sourceDocId: "ext-42",
					fileSize: 2048,
				})}
				onOpenChange={() => {}}
			/>,
		);

		// Heading shows the file name + the file-type badge label.
		expect(screen.getByText("alpha.md")).toBeInTheDocument();
		expect(screen.getByText("MD")).toBeInTheDocument();
		// KV grid renders document id, source id, size, mime type, hash.
		expect(screen.getByText("Document ID")).toBeInTheDocument();
		expect(screen.getByText("Source ID")).toBeInTheDocument();
		expect(screen.getByText("ext-42")).toBeInTheDocument();
		expect(screen.getByText("2.0 KB")).toBeInTheDocument();
		expect(screen.getByText("text/markdown")).toBeInTheDocument();
		expect(screen.getByText("sha256:abc")).toBeInTheDocument();
		// "Chunks" appears twice — once as the KV label and once as the
		// chunks-list section header (with the count). Both must be
		// present for a ready doc whose chunk fetch resolved.
		const chunkLabels = screen.getAllByText(/Chunks/);
		expect(chunkLabels.length).toBeGreaterThanOrEqual(2);
	});

	it("falls back to documentId in the title when sourceFilename is null", () => {
		render(
			<DocumentDetailDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc({ sourceFilename: null })}
				onOpenChange={() => {}}
			/>,
		);
		// The documentId shows up both in the title (fallback) and in
		// the KV grid — both must be present.
		const matches = screen.getAllByText("00000000-0000-4000-8000-000000000003");
		expect(matches.length).toBeGreaterThanOrEqual(2);
	});

	it("shows the failure error block when status is failed", () => {
		render(
			<DocumentDetailDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc({
					status: "failed",
					errorMessage: "boom: parser explosion",
				})}
				onOpenChange={() => {}}
			/>,
		);
		expect(screen.getByText("Error")).toBeInTheDocument();
		expect(screen.getByText(/boom: parser explosion/)).toBeInTheDocument();
		// Failed docs do not render the chunks-list section, so the
		// "No chunks under this document" empty-state copy must be
		// absent. The KV label "Chunks" is still rendered (one match).
		expect(
			screen.queryByText(/No chunks under this document/),
		).not.toBeInTheDocument();
		const chunkLabels = screen.getAllByText(/Chunks/);
		expect(chunkLabels.length).toBe(1);
	});

	it("renders the metadata grid when the doc has metadata entries", () => {
		render(
			<DocumentDetailDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc({
					metadata: { source: "upload", uploader: "ericrhare@gmail.com" },
				})}
				onOpenChange={() => {}}
			/>,
		);
		expect(screen.getByText("Metadata")).toBeInTheDocument();
		expect(screen.getByText("source")).toBeInTheDocument();
		expect(screen.getByText("upload")).toBeInTheDocument();
		expect(screen.getByText("uploader")).toBeInTheDocument();
		expect(screen.getByText("ericrhare@gmail.com")).toBeInTheDocument();
	});

	it("shows the loading spinner copy while chunks are loading", () => {
		chunksState.isLoading = true;
		render(
			<DocumentDetailDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc()}
				onOpenChange={() => {}}
			/>,
		);
		expect(screen.getByText(/Loading chunks/)).toBeInTheDocument();
	});

	it("shows the error message when the chunks query fails", () => {
		chunksState.isError = true;
		chunksState.error = new Error("network fell over");
		render(
			<DocumentDetailDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc()}
				onOpenChange={() => {}}
			/>,
		);
		expect(
			screen.getByText(/Couldn't load chunks: network fell over/),
		).toBeInTheDocument();
	});

	it("shows the empty-state copy when chunks resolve to []", () => {
		chunksState.data = [];
		render(
			<DocumentDetailDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc()}
				onOpenChange={() => {}}
			/>,
		);
		expect(
			screen.getByText(/No chunks under this document/),
		).toBeInTheDocument();
	});

	it("renders chunk rows and highlights the matching chunk when highlightChunkId is set", () => {
		chunksState.data = [
			{ id: "c-1", chunkIndex: 0, text: "hello world", payload: {} },
			{ id: "c-2", chunkIndex: 1, text: null, payload: {} },
			{ id: "c-3", chunkIndex: 2, text: "second pass", payload: {} },
		];
		render(
			<DocumentDetailDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc()}
				highlightChunkId="c-3"
				onOpenChange={() => {}}
			/>,
		);
		expect(screen.getByText("hello world")).toBeInTheDocument();
		// chunkIndex null should never happen here, but a chunk with no
		// text falls back to the "(text not stored)" placeholder.
		expect(
			screen.getByText(/text not stored — older ingest/),
		).toBeInTheDocument();
		expect(screen.getByText("second pass")).toBeInTheDocument();
		// The highlight row is identifiable via its data-testid.
		expect(screen.getByTestId("chunk-highlight")).toBeInTheDocument();
	});
});
