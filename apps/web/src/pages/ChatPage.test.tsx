import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Chat, ChatMessage, Workspace } from "@/lib/schemas";

vi.mock("@/lib/api", () => {
	class ApiError extends Error {
		status: number;
		code: string;
		requestId: string;
		constructor(
			status: number,
			code: string,
			message: string,
			requestId: string,
		) {
			super(message);
			this.status = status;
			this.code = code;
			this.requestId = requestId;
		}
	}
	return {
		api: {
			getWorkspace: vi.fn(),
			listChats: vi.fn(),
			getChat: vi.fn(),
			createChat: vi.fn(),
			deleteChat: vi.fn(),
			listChatMessages: vi.fn(),
		},
		ApiError,
		formatApiError: (err: unknown) =>
			err instanceof Error ? err.message : "Unknown error",
	};
});

vi.mock("@/lib/chatStream", () => ({
	sendChatStream: vi.fn(),
}));

// Confirm dialogs trigger window.confirm — auto-accept in tests.
vi.spyOn(window, "confirm").mockImplementation(() => true);

import { api } from "@/lib/api";
import { sendChatStream } from "@/lib/chatStream";
import { ChatPage } from "./ChatPage";

const workspace: Workspace = {
	workspaceId: "11111111-2222-4333-8444-000000000001",
	name: "prod",
	url: null,
	kind: "astra",
	credentials: {},
	keyspace: null,
	createdAt: "2026-04-22T10:11:12.345Z",
	updatedAt: "2026-04-22T10:11:12.345Z",
};

const chatA: Chat = {
	workspaceId: workspace.workspaceId,
	chatId: "22222222-3333-4444-8555-000000000001",
	title: "Chat A",
	knowledgeBaseIds: [],
	createdAt: "2026-04-22T10:11:12.345Z",
};

const chatB: Chat = {
	workspaceId: workspace.workspaceId,
	chatId: "22222222-3333-4444-8555-000000000002",
	title: "Chat B",
	knowledgeBaseIds: ["33333333-4444-4555-8666-000000000001"],
	createdAt: "2026-04-23T10:11:12.345Z",
};

const userMessage: ChatMessage = {
	workspaceId: workspace.workspaceId,
	chatId: chatA.chatId,
	messageId: "44444444-5555-4666-8777-000000000001",
	messageTs: "2026-04-22T10:11:12.345Z",
	role: "user",
	content: "hello bobbie",
	tokenCount: null,
	metadata: {},
};

function renderAt(path: string) {
	const qc = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route path="/workspaces/:workspaceUid/chat" element={<ChatPage />} />
					<Route
						path="/workspaces/:workspaceUid"
						element={<div>workspace detail</div>}
					/>
					<Route path="/" element={<div>home</div>} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("ChatPage", () => {
	it("renders the empty state when the workspace has no chats", async () => {
		vi.mocked(api.getWorkspace).mockResolvedValue(workspace);
		vi.mocked(api.listChats).mockResolvedValue([]);

		renderAt(`/workspaces/${workspace.workspaceId}/chat`);

		await waitFor(() =>
			expect(
				screen.getByRole("heading", { name: /Chat with Bobbie/i }),
			).toBeInTheDocument(),
		);
		expect(screen.getByText(/No chats yet/i)).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: new RegExp(workspace.name) }),
		).toHaveAttribute("href", `/workspaces/${workspace.workspaceId}`);
	});

	it("lists existing chats and lets the user pick one", async () => {
		vi.mocked(api.getWorkspace).mockResolvedValue(workspace);
		vi.mocked(api.listChats).mockResolvedValue([chatB, chatA]);
		vi.mocked(api.getChat).mockResolvedValue(chatA);
		vi.mocked(api.listChatMessages).mockResolvedValue([]);

		const user = userEvent.setup();
		renderAt(`/workspaces/${workspace.workspaceId}/chat`);

		await waitFor(() => expect(screen.getByText("Chat A")).toBeInTheDocument());
		expect(screen.getByText("Chat B")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /Chat A/ }));
		await waitFor(() =>
			expect(
				screen.getByRole("heading", { name: /Chat A/i }),
			).toBeInTheDocument(),
		);
		expect(screen.getByText(/all knowledge bases/i)).toBeInTheDocument();
		expect(screen.getByTestId("chat-empty-messages")).toBeInTheDocument();
	});

	it("renders message history and streams Bobbie's reply token-by-token", async () => {
		vi.mocked(api.getWorkspace).mockResolvedValue(workspace);
		vi.mocked(api.listChats).mockResolvedValue([chatA]);
		vi.mocked(api.getChat).mockResolvedValue(chatA);
		vi.mocked(api.listChatMessages).mockResolvedValue([userMessage]);
		const echoedUser: ChatMessage = {
			...userMessage,
			messageId: "44444444-5555-4666-8777-000000000002",
			messageTs: "2026-04-22T10:11:13.000Z",
			content: "another one",
		};
		const bobbieReply: ChatMessage = {
			...userMessage,
			messageId: "44444444-5555-4666-8777-000000000003",
			messageTs: "2026-04-22T10:11:14.000Z",
			role: "agent",
			content: "Here is what I think.",
			metadata: {
				model: "fake-test-model",
				finish_reason: "stop",
				context_document_ids: "chunk-1,chunk-2",
			},
		};
		// Replay a fake stream: user-message, three token chunks,
		// then a terminal `done` carrying the persisted assistant row.
		vi.mocked(sendChatStream).mockImplementation(async (_ws, _id, opts) => {
			opts.onEvent({ type: "user-message", message: echoedUser });
			opts.onEvent({ type: "token", delta: "Here is " });
			opts.onEvent({ type: "token", delta: "what I " });
			opts.onEvent({ type: "token", delta: "think." });
			opts.onEvent({ type: "done", assistant: bobbieReply });
		});

		const user = userEvent.setup();
		renderAt(`/workspaces/${workspace.workspaceId}/chat?id=${chatA.chatId}`);

		await waitFor(() =>
			expect(screen.getByText("hello bobbie")).toBeInTheDocument(),
		);

		const composer = screen.getByRole("textbox", { name: /message/i });
		await user.type(composer, "another one");
		await user.click(screen.getByRole("button", { name: /^Send$/ }));

		await waitFor(() => {
			expect(sendChatStream).toHaveBeenCalledWith(
				workspace.workspaceId,
				chatA.chatId,
				expect.objectContaining({ content: "another one" }),
			);
		});
		// Both the user echo and Bobbie's reply land in the cache.
		await waitFor(() =>
			expect(screen.getByText("another one")).toBeInTheDocument(),
		);
		expect(screen.getByText("Here is what I think.")).toBeInTheDocument();
		// Source-citation disclosure renders the chunk IDs.
		expect(screen.getByText(/2 sources/i)).toBeInTheDocument();
	});

	it("shows the streaming bubble while tokens arrive", async () => {
		vi.mocked(api.getWorkspace).mockResolvedValue(workspace);
		vi.mocked(api.listChats).mockResolvedValue([chatA]);
		vi.mocked(api.getChat).mockResolvedValue(chatA);
		vi.mocked(api.listChatMessages).mockResolvedValue([]);
		const echoedUser: ChatMessage = {
			...userMessage,
			messageId: "44444444-5555-4666-8777-100000000002",
			content: "ping",
		};
		const bobbieReply: ChatMessage = {
			...userMessage,
			messageId: "44444444-5555-4666-8777-100000000003",
			role: "agent",
			content: "pong",
			metadata: { model: "fake-test-model", finish_reason: "stop" },
		};
		// Hold the mock open until the test releases it, so we can
		// deterministically observe the streaming bubble before `done`
		// flips `pending` back to false. Without this gate the React
		// render that includes the bubble can race the post-`done`
		// re-render and the assertion flakes.
		let releaseDone: () => void = () => {};
		const donePromise = new Promise<void>((resolve) => {
			releaseDone = resolve;
		});
		vi.mocked(sendChatStream).mockImplementation(async (_ws, _id, opts) => {
			opts.onEvent({ type: "user-message", message: echoedUser });
			opts.onEvent({ type: "token", delta: "po" });
			opts.onEvent({ type: "token", delta: "ng" });
			await donePromise;
			opts.onEvent({ type: "done", assistant: bobbieReply });
		});

		const user = userEvent.setup();
		renderAt(`/workspaces/${workspace.workspaceId}/chat?id=${chatA.chatId}`);

		await waitFor(() =>
			expect(
				screen.getByRole("textbox", { name: /message/i }),
			).toBeInTheDocument(),
		);
		await user.type(screen.getByRole("textbox", { name: /message/i }), "ping");
		await user.click(screen.getByRole("button", { name: /^Send$/ }));

		// Streaming bubble appears while tokens are arriving.
		await waitFor(() =>
			expect(screen.getByTestId("bobbie-streaming")).toBeInTheDocument(),
		);
		expect(screen.getByTestId("bobbie-streaming")).toHaveTextContent(/pong/);

		// Release `done` and watch the bubble disappear in favor of the
		// canonical assistant row.
		releaseDone();
		await waitFor(() =>
			expect(screen.queryByTestId("bobbie-streaming")).not.toBeInTheDocument(),
		);
		expect(screen.getByText("pong")).toBeInTheDocument();
	});

	it("renders an error styling when Bobbie's reply has finish_reason=error", async () => {
		vi.mocked(api.getWorkspace).mockResolvedValue(workspace);
		vi.mocked(api.listChats).mockResolvedValue([chatA]);
		vi.mocked(api.getChat).mockResolvedValue(chatA);
		const erroredReply: ChatMessage = {
			...userMessage,
			messageId: "44444444-5555-4666-8777-000000000010",
			messageTs: "2026-04-22T10:11:14.000Z",
			role: "agent",
			content: "HuggingFace inference failed: rate limit",
			metadata: {
				model: "fake",
				finish_reason: "error",
				error_message: "rate limit",
			},
		};
		vi.mocked(api.listChatMessages).mockResolvedValue([
			userMessage,
			erroredReply,
		]);

		renderAt(`/workspaces/${workspace.workspaceId}/chat?id=${chatA.chatId}`);

		await waitFor(() =>
			expect(
				screen.getByText(/HuggingFace inference failed/),
			).toBeInTheDocument(),
		);
		expect(screen.getByTestId("bobbie-error")).toBeInTheDocument();
	});

	it("creates a chat from the empty pane and selects it", async () => {
		vi.mocked(api.getWorkspace).mockResolvedValue(workspace);
		vi.mocked(api.listChats).mockResolvedValue([]);
		vi.mocked(api.createChat).mockResolvedValue(chatA);
		vi.mocked(api.getChat).mockResolvedValue(chatA);
		vi.mocked(api.listChatMessages).mockResolvedValue([]);

		const user = userEvent.setup();
		renderAt(`/workspaces/${workspace.workspaceId}/chat`);

		await waitFor(() =>
			expect(screen.getByText(/No chats yet/i)).toBeInTheDocument(),
		);

		await user.click(screen.getByRole("button", { name: /Start a chat/i }));

		await waitFor(() =>
			expect(api.createChat).toHaveBeenCalledWith(workspace.workspaceId, {
				title: "New chat",
			}),
		);
	});

	it("surfaces a workspace not-found error gracefully", async () => {
		const apiModule = await import("@/lib/api");
		const ApiError = (
			apiModule as unknown as { ApiError: new (...args: unknown[]) => Error }
		).ApiError;
		vi.mocked(api.getWorkspace).mockRejectedValue(
			new ApiError(404, "workspace_not_found", "missing", "req-1"),
		);
		vi.mocked(api.listChats).mockResolvedValue([]);

		renderAt(`/workspaces/${workspace.workspaceId}/chat`);

		await waitFor(() =>
			expect(screen.getByText(/Couldn't load workspace/i)).toBeInTheDocument(),
		);
		expect(
			screen.getByRole("link", { name: /back to workspaces/i }),
		).toHaveAttribute("href", "/");
	});
});
