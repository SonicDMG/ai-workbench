import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	ChatMessage,
	DocumentChunk,
	RagDocumentRecord,
} from "@/lib/schemas";

vi.mock("@/lib/api", () => ({
	api: {
		listKbDocumentChunks: vi.fn(),
		listKbDocuments: vi.fn(() => Promise.resolve([])),
	},
	ApiError: class ApiError extends Error {},
}));

import { api } from "@/lib/api";
import { RetrievedContextPanel } from "./RetrievedContextPanel";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return (
		<QueryClientProvider client={qc}>
			<MemoryRouter>{children}</MemoryRouter>
		</QueryClientProvider>
	);
}

const WS = "00000000-0000-4000-8000-000000000001";
const KB = "00000000-0000-4000-8000-000000000aaa";
const DOC = "00000000-0000-4000-8000-000000000bbb";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		workspaceId: WS,
		chatId: "chat-1",
		messageId: "msg-1",
		messageTs: "2026-05-04T12:00:00.000Z",
		role: "agent",
		content: "Answer.",
		tokenCount: 0,
		metadata: {},
		...overrides,
	} as unknown as ChatMessage;
}

function chunkFixture(id: string, text: string): DocumentChunk {
	return {
		id,
		chunkIndex: 0,
		text,
		payload: {},
	};
}

afterEach(() => {
	vi.mocked(api.listKbDocumentChunks).mockReset();
});

describe("RetrievedContextPanel", () => {
	it("nudges the user to send a message when there is no assistant turn yet", () => {
		render(
			<RetrievedContextPanel
				workspaceId={WS}
				messages={[
					makeMessage({
						role: "user",
						content: "what's in policy doc?",
					}),
				]}
			/>,
			{ wrapper },
		);

		expect(
			screen.getByText(/Send a message to see what the agent retrieved/i),
		).toBeInTheDocument();
	});

	it("surfaces the no-RAG state explicitly when the latest assistant turn has no citations", () => {
		render(
			<RetrievedContextPanel
				workspaceId={WS}
				messages={[
					makeMessage({ role: "user", content: "hi" }),
					makeMessage({ role: "agent", content: "hello" }),
				]}
			/>,
			{ wrapper },
		);

		expect(
			screen.getByText(/didn't draw on the knowledge base/i),
		).toBeInTheDocument();
	});

	it("renders one group per cited document and previews each chunk's text", async () => {
		vi.mocked(api.listKbDocumentChunks).mockResolvedValueOnce([
			chunkFixture("chunk-aa", "the policy applies to all teams"),
			chunkFixture("chunk-bb", "exceptions require approval"),
			chunkFixture("chunk-cc", "unrelated chunk"),
		]);

		render(
			<RetrievedContextPanel
				workspaceId={WS}
				messages={[
					makeMessage({
						metadata: {
							context_chunks: JSON.stringify([
								["chunk-aa", KB, DOC],
								["chunk-bb", KB, DOC],
							]),
						},
					}),
				]}
			/>,
			{ wrapper },
		);

		// Both cited chunks should preview after the document fetch resolves.
		expect(
			await screen.findByText(/the policy applies to all teams/),
		).toBeInTheDocument();
		expect(screen.getByText(/exceptions require approval/)).toBeInTheDocument();
		// And the uncited chunk from the same document should NOT show up.
		expect(screen.queryByText(/unrelated chunk/)).not.toBeInTheDocument();

		// The per-document "Open" affordance is a button now (it opens
		// the DocumentDetailDialog overlay instead of navigating away).
		expect(
			screen.getByRole("button", {
				name: /Open document/i,
			}),
		).toBeInTheDocument();

		// Group count = 1 since both chunks share a document.
		expect(screen.getByTestId("context-panel-groups").children.length).toBe(1);
	});

	it("opens the DocumentDetailDialog overlay when a chunk row is clicked", async () => {
		vi.mocked(api.listKbDocumentChunks).mockResolvedValueOnce([
			chunkFixture("chunk-aa", "team-wide policy"),
		]);
		const docFixture: RagDocumentRecord = {
			workspaceId: WS,
			knowledgeBaseId: KB,
			documentId: DOC,
			sourceDocId: null,
			sourceFilename: "policy.md",
			fileType: "md",
			fileSize: 100,
			contentHash: null,
			chunkTotal: 1,
			ingestedAt: "2026-05-04T12:00:00.000Z",
			updatedAt: "2026-05-04T12:00:00.000Z",
			status: "ready",
			errorMessage: null,
			metadata: {},
		};
		vi.mocked(api.listKbDocuments).mockResolvedValue([docFixture]);

		const user = userEvent.setup();
		render(
			<RetrievedContextPanel
				workspaceId={WS}
				messages={[
					makeMessage({
						metadata: {
							context_chunks: JSON.stringify([["chunk-aa", KB, DOC]]),
						},
					}),
				]}
			/>,
			{ wrapper },
		);

		// Click the chunk row.
		const row = await screen.findByText(/team-wide policy/);
		await user.click(row);

		// DocumentDetailDialog should mount overlaid. It always renders
		// a `dialog` role with the document filename in the title once
		// `doc` resolves.
		expect(await screen.findByRole("dialog")).toBeInTheDocument();
		expect(api.listKbDocuments).toHaveBeenCalledWith(WS, KB);
	});

	it("renders chunks with no documentId as a legacy-citation group with no Open button", async () => {
		render(
			<RetrievedContextPanel
				workspaceId={WS}
				messages={[
					makeMessage({
						metadata: {
							// Legacy `context_document_ids` payload — chunkId only,
							// kbId blank, documentId null.
							context_document_ids: "legacy-1, legacy-2",
						},
					}),
				]}
			/>,
			{ wrapper },
		);

		expect(screen.getByText(/Legacy citation/i)).toBeInTheDocument();
		// No "Open" button for legacy citations — there's no document
		// to open.
		expect(
			screen.queryByRole("button", { name: /Open document/i }),
		).not.toBeInTheDocument();
		// And no chunk-row link/button either — legacy citations render
		// as non-interactive cards.
		expect(screen.queryAllByRole("button", { name: /chunk/i })).toHaveLength(0);
		// No document fetch fired because there's no documentId to query.
		expect(api.listKbDocumentChunks).not.toHaveBeenCalled();
	});

	it("falls through to a friendly error when the chunk fetch fails", async () => {
		vi.mocked(api.listKbDocumentChunks).mockRejectedValueOnce(
			new Error("boom"),
		);

		render(
			<RetrievedContextPanel
				workspaceId={WS}
				messages={[
					makeMessage({
						metadata: {
							context_chunks: JSON.stringify([["chunk-aa", KB, DOC]]),
						},
					}),
				]}
			/>,
			{ wrapper },
		);

		expect(
			await screen.findByText(/Couldn't load chunk preview/i),
		).toBeInTheDocument();
	});

	it("uses the most recent assistant turn (not the first) for context", async () => {
		vi.mocked(api.listKbDocumentChunks).mockResolvedValueOnce([
			chunkFixture("chunk-zz", "newest turn chunk"),
		]);

		render(
			<RetrievedContextPanel
				workspaceId={WS}
				messages={[
					// Older assistant turn with stale citation — should be ignored.
					makeMessage({
						messageId: "old",
						metadata: {
							context_chunks: JSON.stringify([["chunk-aa", KB, DOC]]),
						},
					}),
					makeMessage({ role: "user", content: "follow up" }),
					// Latest assistant turn — its chunks are what render.
					makeMessage({
						messageId: "new",
						metadata: {
							context_chunks: JSON.stringify([["chunk-zz", KB, DOC]]),
						},
					}),
				]}
			/>,
			{ wrapper },
		);

		expect(await screen.findByText(/newest turn chunk/)).toBeInTheDocument();
		// `chunk-aa` from the older turn must not appear in the panel.
		expect(screen.queryByText(/chunk-aa/)).not.toBeInTheDocument();
	});
});
