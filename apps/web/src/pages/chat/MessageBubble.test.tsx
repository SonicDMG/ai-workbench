import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ChunkRef } from "@/components/chat/MarkdownContent";
import type { ChatMessage } from "@/lib/schemas";
import {
	AgentThinking,
	citationHref,
	EmptyMessages,
	MessageBubble,
	SourcesDisclosure,
	StreamingBubble,
} from "./MessageBubble";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		chatId: "00000000-0000-4000-8000-000000000002",
		messageId: "00000000-0000-4000-8000-000000000003",
		messageTs: "2026-04-25T10:00:00.000Z",
		role: "user",
		content: "hello there",
		tokenCount: null,
		metadata: {},
		...overrides,
	};
}

function renderInRouter(node: React.ReactNode) {
	return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("MessageBubble", () => {
	it("renders a user message with the literal content and 'You' label", () => {
		renderInRouter(
			<MessageBubble
				message={makeMessage({ role: "user", content: "ping" })}
				workspaceId="ws-1"
				agentName="Bobbie"
			/>,
		);
		expect(screen.getByText("You")).toBeInTheDocument();
		expect(screen.getByText("ping")).toBeInTheDocument();
		// User content is plain text, never markdown-rendered, so the
		// agent-error testid is absent.
		expect(screen.queryByTestId("agent-error")).not.toBeInTheDocument();
	});

	it("labels the bubble with the agent name when role is agent", () => {
		renderInRouter(
			<MessageBubble
				message={makeMessage({ role: "agent", content: "pong" })}
				workspaceId="ws-1"
				agentName="Bobbie"
			/>,
		);
		expect(screen.getByText("Bobbie")).toBeInTheDocument();
		// Agent reply renders through MarkdownContent, so the visible
		// text still appears in the DOM.
		expect(screen.getByText("pong")).toBeInTheDocument();
	});

	it("flags an agent reply with a finish_reason of 'error' via data-testid", () => {
		renderInRouter(
			<MessageBubble
				message={makeMessage({
					role: "agent",
					content: "boom",
					metadata: { finish_reason: "error" },
				})}
				workspaceId="ws-1"
				agentName="Bobbie"
			/>,
		);
		expect(screen.getByTestId("agent-error")).toBeInTheDocument();
		expect(screen.getByText("boom")).toBeInTheDocument();
	});

	it("renders a SourcesDisclosure when the agent reply has chunk citations", () => {
		// `parseChunkMap` reads the metadata's `context_chunks` JSON key,
		// which holds an array of `[chunkId, kbId, docId]` tuples.
		const contextChunks = JSON.stringify([["chunk-1", "kb-1", "doc-1"]]);
		renderInRouter(
			<MessageBubble
				message={makeMessage({
					role: "agent",
					content: "with sources",
					metadata: { context_chunks: contextChunks },
				})}
				workspaceId="ws-1"
				agentName="Bobbie"
			/>,
		);
		expect(screen.getByText(/1 source/)).toBeInTheDocument();
	});

	it("falls back to the empty string when content is null", () => {
		// A user message with null content shouldn't crash the bubble —
		// the JSX render path uses `(message.content ?? "")`.
		renderInRouter(
			<MessageBubble
				message={makeMessage({ role: "user", content: null })}
				workspaceId="ws-1"
				agentName="Bobbie"
			/>,
		);
		expect(screen.getByText("You")).toBeInTheDocument();
	});
});

describe("SourcesDisclosure", () => {
	it("links chunks with a knowledgeBaseId via citationHref", () => {
		const chunks = new Map<string, ChunkRef>([
			[
				"chunk-1",
				{ chunkId: "chunk-1", knowledgeBaseId: "kb-9", documentId: "doc-9" },
			],
		]);
		renderInRouter(<SourcesDisclosure workspaceId="ws-1" chunks={chunks} />);
		const link = screen.getByTestId("chat-source-link");
		expect(link).toHaveAttribute(
			"href",
			"/workspaces/ws-1/knowledge-bases/kb-9?document=doc-9&chunk=chunk-1",
		);
	});

	it("renders chunks without a KB id as plain text (legacy fallback)", () => {
		const chunks = new Map<string, ChunkRef>([
			[
				"legacy-1",
				{ chunkId: "legacy-1", knowledgeBaseId: "", documentId: null },
			],
		]);
		renderInRouter(<SourcesDisclosure workspaceId="ws-1" chunks={chunks} />);
		expect(screen.queryByTestId("chat-source-link")).not.toBeInTheDocument();
		expect(screen.getByText("legacy-1")).toBeInTheDocument();
	});

	it("pluralises the summary based on chunk count", () => {
		const chunks = new Map<string, ChunkRef>([
			["c1", { chunkId: "c1", knowledgeBaseId: "kb", documentId: "d1" }],
			["c2", { chunkId: "c2", knowledgeBaseId: "kb", documentId: "d2" }],
		]);
		renderInRouter(<SourcesDisclosure workspaceId="ws-1" chunks={chunks} />);
		expect(screen.getByText("2 sources")).toBeInTheDocument();
	});
});

describe("citationHref", () => {
	it("includes the document param when documentId is set", () => {
		expect(
			citationHref("ws-1", {
				chunkId: "c-1",
				knowledgeBaseId: "kb-1",
				documentId: "doc-1",
			}),
		).toBe("/workspaces/ws-1/knowledge-bases/kb-1?document=doc-1&chunk=c-1");
	});

	it("omits the document param when documentId is null", () => {
		expect(
			citationHref("ws-1", {
				chunkId: "c-1",
				knowledgeBaseId: "kb-1",
				documentId: null,
			}),
		).toBe("/workspaces/ws-1/knowledge-bases/kb-1?chunk=c-1");
	});
});

describe("EmptyMessages", () => {
	it("shows the agent name in the helper copy", () => {
		render(<EmptyMessages agentName="Bobbie" />);
		expect(screen.getByTestId("chat-empty-messages")).toBeInTheDocument();
		expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
		expect(screen.getByText(/Bobbie streams its replies/)).toBeInTheDocument();
	});
});

describe("AgentThinking", () => {
	it("renders the thinking spinner with the agent name", () => {
		render(
			<ul>
				<AgentThinking agentName="Bobbie" />
			</ul>,
		);
		expect(screen.getByTestId("agent-thinking")).toBeInTheDocument();
		expect(screen.getByText(/Bobbie is thinking/)).toBeInTheDocument();
	});
});

describe("StreamingBubble", () => {
	it("falls back to AgentThinking when no tokens have arrived yet", () => {
		render(
			<ul>
				<StreamingBubble delta="" agentName="Bobbie" />
			</ul>,
		);
		expect(screen.getByTestId("agent-thinking")).toBeInTheDocument();
	});

	it("renders the streaming bubble with the in-flight delta", () => {
		render(
			<ul>
				<StreamingBubble delta="hello, wo" agentName="Bobbie" />
			</ul>,
		);
		expect(screen.getByTestId("agent-streaming")).toBeInTheDocument();
		expect(screen.getByText(/hello, wo/)).toBeInTheDocument();
	});
});
