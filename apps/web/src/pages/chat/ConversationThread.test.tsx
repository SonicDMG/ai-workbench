import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type {
	AgentRecord,
	ChatMessage,
	ConversationRecord,
} from "@/lib/schemas";

type QueryState<T> = {
	data: T | undefined;
	error: Error | null;
	isLoading: boolean;
	isError: boolean;
};

const conversationState: QueryState<ConversationRecord> = {
	data: undefined,
	error: null,
	isLoading: false,
	isError: false,
};
const messagesState: QueryState<readonly ChatMessage[]> = {
	data: [],
	error: null,
	isLoading: false,
	isError: false,
};
const deleteState = {
	mutateAsync: vi.fn<(id: string) => Promise<void>>(),
	isPending: false,
};
const createState = {
	mutateAsync: vi.fn<(input: unknown) => Promise<ConversationRecord>>(),
	isPending: false,
};
const streamState = {
	send: vi.fn<(content: string) => Promise<void>>(),
	pendingDelta: "",
	pending: false,
	error: null as string | null,
	cancel: vi.fn(),
};

vi.mock("@/hooks/useConversations", () => ({
	useConversation: () => ({
		data: conversationState.data,
		error: conversationState.error,
		isLoading: conversationState.isLoading,
		isError: conversationState.isError,
	}),
	useConversationMessages: () => ({
		data: messagesState.data,
		error: messagesState.error,
		isLoading: messagesState.isLoading,
		isError: messagesState.isError,
	}),
	useDeleteConversation: () => ({
		mutateAsync: deleteState.mutateAsync,
		isPending: deleteState.isPending,
	}),
	useCreateConversation: () => ({
		mutateAsync: createState.mutateAsync,
		isPending: createState.isPending,
	}),
	useSendConversationStream: () => ({
		send: streamState.send,
		pendingDelta: streamState.pendingDelta,
		pending: streamState.pending,
		error: streamState.error,
		cancel: streamState.cancel,
	}),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

import {
	ConversationThread,
	EmptyConversationPane,
} from "./ConversationThread";

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		agentId: "00000000-0000-4000-8000-000000000002",
		name: "Bobbie",
		description: null,
		systemPrompt: null,
		userPrompt: null,
		llmServiceId: null,
		ragEnabled: false,
		knowledgeBaseIds: [],
		ragMaxResults: null,
		ragMinScore: null,
		rerankEnabled: false,
		rerankingServiceId: null,
		rerankMaxResults: null,
		createdAt: "2026-04-25T10:00:00.000Z",
		updatedAt: "2026-04-25T10:00:00.000Z",
		...overrides,
	};
}

function makeConv(
	overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		agentId: "00000000-0000-4000-8000-000000000002",
		conversationId: "00000000-0000-4000-8000-000000000003",
		title: "Topic A",
		knowledgeBaseIds: [],
		createdAt: "2026-04-25T10:00:00.000Z",
		...overrides,
	};
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		chatId: "00000000-0000-4000-8000-000000000003",
		messageId: "00000000-0000-4000-8000-000000000010",
		messageTs: "2026-04-25T10:00:00.000Z",
		role: "user",
		content: "hi",
		tokenCount: null,
		metadata: {},
		...overrides,
	};
}

function renderInRouter(node: React.ReactNode) {
	return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
	conversationState.data = undefined;
	conversationState.error = null;
	conversationState.isLoading = false;
	conversationState.isError = false;
	messagesState.data = [];
	messagesState.error = null;
	messagesState.isLoading = false;
	messagesState.isError = false;
	deleteState.mutateAsync = vi.fn();
	deleteState.isPending = false;
	createState.mutateAsync = vi.fn();
	createState.isPending = false;
	streamState.send = vi.fn();
	streamState.pendingDelta = "";
	streamState.pending = false;
	streamState.error = null;
	streamState.cancel = vi.fn();
});

describe("ConversationThread", () => {
	it("renders the loading state while the conversation query resolves", () => {
		conversationState.isLoading = true;
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent()}
				conversationId="conv-1"
				onDeleted={() => {}}
			/>,
		);
		expect(screen.getByText(/Loading conversation/)).toBeInTheDocument();
	});

	it("surfaces a friendly message when the conversation 404s", () => {
		conversationState.isError = true;
		conversationState.error = new ApiError(
			404,
			"conversation_not_found",
			"missing",
			"req-1",
		);
		conversationState.data = undefined;
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent()}
				conversationId="conv-1"
				onDeleted={() => {}}
			/>,
		);
		expect(screen.getByText(/Couldn't load conversation/)).toBeInTheDocument();
		expect(
			screen.getByText(/This conversation doesn't exist or was deleted/),
		).toBeInTheDocument();
	});

	it("renders the EmptyMessages helper when no messages and stream is idle", () => {
		conversationState.data = makeConv({ title: "Untitled topic" });
		messagesState.data = [];
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent({ name: "Bobbie" })}
				conversationId="conv-1"
				onDeleted={() => {}}
			/>,
		);
		expect(screen.getByTestId("chat-empty-messages")).toBeInTheDocument();
		expect(screen.getByText(/Bobbie streams its replies/)).toBeInTheDocument();
	});

	it("renders one MessageBubble per persisted message", () => {
		conversationState.data = makeConv();
		messagesState.data = [
			makeMessage({
				messageId: "00000000-0000-4000-8000-00000000aaaa",
				role: "user",
				content: "hi from me",
			}),
			makeMessage({
				messageId: "00000000-0000-4000-8000-00000000bbbb",
				role: "agent",
				content: "hi back",
			}),
		];
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent({ name: "Bobbie" })}
				conversationId="conv-1"
				onDeleted={() => {}}
			/>,
		);
		expect(screen.getByText("hi from me")).toBeInTheDocument();
		expect(screen.getByText("hi back")).toBeInTheDocument();
	});

	it("shows a StreamingBubble while the SSE reply is in flight", () => {
		conversationState.data = makeConv();
		messagesState.data = [makeMessage({ role: "user", content: "ping" })];
		streamState.pending = true;
		streamState.pendingDelta = "po";
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent()}
				conversationId="conv-1"
				onDeleted={() => {}}
			/>,
		);
		expect(screen.getByTestId("agent-streaming")).toBeInTheDocument();
	});

	it("disables Send while a reply is streaming and exposes a Cancel affordance", () => {
		conversationState.data = makeConv();
		streamState.pending = true;
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent()}
				conversationId="conv-1"
				onDeleted={() => {}}
			/>,
		);
		expect(screen.getByRole("button", { name: /Streaming…/ })).toBeDisabled();
		expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument();
	});

	it("calls stream.send with the trimmed draft when the form submits", async () => {
		const user = userEvent.setup();
		conversationState.data = makeConv();
		streamState.send = vi.fn().mockResolvedValue(undefined);
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent()}
				conversationId="conv-1"
				onDeleted={() => {}}
			/>,
		);
		const composer = screen.getByLabelText("Message");
		await user.type(composer, "  hello, agent  ");
		await user.click(screen.getByRole("button", { name: /^Send$/ }));
		await waitFor(() => {
			expect(streamState.send).toHaveBeenCalledWith("hello, agent");
		});
	});

	it("ignores the submit when the draft is whitespace-only", async () => {
		const user = userEvent.setup();
		conversationState.data = makeConv();
		streamState.send = vi.fn();
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent()}
				conversationId="conv-1"
				onDeleted={() => {}}
			/>,
		);
		const composer = screen.getByLabelText("Message");
		await user.type(composer, "   ");
		expect(screen.getByRole("button", { name: /^Send$/ })).toBeDisabled();
		expect(streamState.send).not.toHaveBeenCalled();
	});

	it("invokes onDeleted after the user confirms the delete", async () => {
		const user = userEvent.setup();
		conversationState.data = makeConv({ title: "Goodbye" });
		deleteState.mutateAsync = vi.fn().mockResolvedValue(undefined);
		const onDeleted = vi.fn();
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent()}
				conversationId="conv-1"
				onDeleted={onDeleted}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /^Delete$/ }));
		await waitFor(() => {
			expect(deleteState.mutateAsync).toHaveBeenCalledWith(
				"00000000-0000-4000-8000-000000000003",
			);
			expect(onDeleted).toHaveBeenCalled();
		});
		confirmSpy.mockRestore();
	});

	it("aborts the delete when the user cancels the confirm prompt", async () => {
		const user = userEvent.setup();
		conversationState.data = makeConv();
		deleteState.mutateAsync = vi.fn();
		const onDeleted = vi.fn();
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent()}
				conversationId="conv-1"
				onDeleted={onDeleted}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /^Delete$/ }));
		expect(deleteState.mutateAsync).not.toHaveBeenCalled();
		expect(onDeleted).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});

	it("renders the per-KB grounding hint when the conversation has KBs attached", () => {
		conversationState.data = makeConv({
			knowledgeBaseIds: [
				"00000000-0000-4000-8000-0000000000aa",
				"00000000-0000-4000-8000-0000000000bb",
			],
		});
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent()}
				conversationId="conv-1"
				onDeleted={() => {}}
			/>,
		);
		expect(screen.getByText(/Grounded in 2 KBs/)).toBeInTheDocument();
	});

	it("falls back to the agent's default-KBs hint when no KBs are attached", () => {
		conversationState.data = makeConv({ knowledgeBaseIds: [] });
		renderInRouter(
			<ConversationThread
				workspaceId="ws-1"
				agent={makeAgent({ name: "Bobbie" })}
				conversationId="conv-1"
				onDeleted={() => {}}
			/>,
		);
		expect(
			screen.getByText(/Grounded in: Bobbie's default knowledge bases/),
		).toBeInTheDocument();
	});
});

describe("EmptyConversationPane", () => {
	it("renders the empty pane copy with the active agent's name", () => {
		renderInRouter(
			<EmptyConversationPane
				workspaceId="ws-1"
				agent={makeAgent({ name: "Bobbie" })}
				onCreated={() => {}}
			/>,
		);
		expect(screen.getByText(/Pick a conversation/)).toBeInTheDocument();
		expect(screen.getByText("Bobbie")).toBeInTheDocument();
	});

	it("creates a fresh conversation and forwards it to onCreated", async () => {
		const user = userEvent.setup();
		const created = makeConv({
			conversationId: "00000000-0000-4000-8000-000000000999",
			title: "New conversation",
		});
		createState.mutateAsync = vi.fn().mockResolvedValue(created);
		const onCreated = vi.fn();
		renderInRouter(
			<EmptyConversationPane
				workspaceId="ws-1"
				agent={makeAgent()}
				onCreated={onCreated}
			/>,
		);
		await user.click(
			screen.getByRole("button", { name: /Start a conversation/ }),
		);
		await waitFor(() => {
			expect(createState.mutateAsync).toHaveBeenCalledWith({
				title: "New conversation",
			});
			expect(onCreated).toHaveBeenCalledWith(created);
		});
	});
});
