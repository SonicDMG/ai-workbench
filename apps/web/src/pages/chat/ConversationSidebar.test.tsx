import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationRecord } from "@/lib/schemas";

type ListState = {
	data: ConversationRecord[] | undefined;
	error: Error | null;
	isLoading: boolean;
	isError: boolean;
};

const listState: ListState = {
	data: [],
	error: null,
	isLoading: false,
	isError: false,
};

const createState = {
	mutateAsync: vi.fn<(input: unknown) => Promise<ConversationRecord>>(),
	isPending: false,
};

vi.mock("@/hooks/useConversations", () => ({
	useConversations: () => ({
		data: listState.data,
		error: listState.error,
		isLoading: listState.isLoading,
		isError: listState.isError,
	}),
	useCreateConversation: () => ({
		mutateAsync: createState.mutateAsync,
		isPending: createState.isPending,
	}),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

import { ConversationSidebar } from "./ConversationSidebar";

function makeConv(
	overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		agentId: "00000000-0000-4000-8000-000000000002",
		conversationId: `00000000-0000-4000-8000-000000000${Math.floor(
			Math.random() * 1000,
		)
			.toString()
			.padStart(3, "0")}`,
		title: "Untitled",
		knowledgeBaseIds: [],
		createdAt: "2026-04-25T10:00:00.000Z",
		...overrides,
	};
}

function renderInRouter(node: React.ReactNode) {
	return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
	listState.data = [];
	listState.error = null;
	listState.isLoading = false;
	listState.isError = false;
	createState.mutateAsync = vi.fn();
	createState.isPending = false;
});

describe("ConversationSidebar", () => {
	it("shows the empty-state copy when there are no conversations", () => {
		renderInRouter(
			<ConversationSidebar
				workspaceId="ws-1"
				agentId="a-1"
				activeConversationId={null}
				onSelect={() => {}}
			/>,
		);
		expect(
			screen.getByText(/No conversations yet\. Start one above/),
		).toBeInTheDocument();
	});

	it("renders one row per conversation with title and KB hint", () => {
		listState.data = [
			makeConv({
				conversationId: "00000000-0000-4000-8000-000000000010",
				title: "Onboarding Q&A",
				knowledgeBaseIds: [],
			}),
			makeConv({
				conversationId: "00000000-0000-4000-8000-000000000011",
				title: "Schema migration plan",
				knowledgeBaseIds: [
					"00000000-0000-4000-8000-000000000020",
					"00000000-0000-4000-8000-000000000021",
				],
			}),
		];
		renderInRouter(
			<ConversationSidebar
				workspaceId="ws-1"
				agentId="a-1"
				activeConversationId={null}
				onSelect={() => {}}
			/>,
		);
		expect(screen.getByText("Onboarding Q&A")).toBeInTheDocument();
		expect(screen.getByText(/agent default KBs/)).toBeInTheDocument();
		expect(screen.getByText("Schema migration plan")).toBeInTheDocument();
		expect(screen.getByText(/2 KBs/)).toBeInTheDocument();
	});

	it("calls onSelect with the chosen conversationId when a row is clicked", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		listState.data = [
			makeConv({
				conversationId: "00000000-0000-4000-8000-000000000099",
				title: "click me",
			}),
		];
		renderInRouter(
			<ConversationSidebar
				workspaceId="ws-1"
				agentId="a-1"
				activeConversationId={null}
				onSelect={onSelect}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /click me/ }));
		expect(onSelect).toHaveBeenCalledWith(
			"00000000-0000-4000-8000-000000000099",
		);
	});

	it("creates a new conversation when 'New conversation' is clicked", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		const created = makeConv({
			conversationId: "00000000-0000-4000-8000-000000000123",
		});
		createState.mutateAsync = vi.fn().mockResolvedValue(created);
		renderInRouter(
			<ConversationSidebar
				workspaceId="ws-1"
				agentId="a-1"
				activeConversationId={null}
				onSelect={onSelect}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /New conversation/ }));
		await waitFor(() => {
			expect(createState.mutateAsync).toHaveBeenCalledWith({
				title: "New conversation",
			});
			expect(onSelect).toHaveBeenCalledWith(
				"00000000-0000-4000-8000-000000000123",
			);
		});
	});

	it("renders a loading hint while the conversation list query is pending", () => {
		listState.isLoading = true;
		listState.data = undefined;
		renderInRouter(
			<ConversationSidebar
				workspaceId="ws-1"
				agentId="a-1"
				activeConversationId={null}
				onSelect={() => {}}
			/>,
		);
		expect(screen.getByText(/Loading…/)).toBeInTheDocument();
	});

	it("renders a red error message when the list query fails", () => {
		listState.isError = true;
		listState.error = new Error("boom: fetch failed");
		listState.data = undefined;
		renderInRouter(
			<ConversationSidebar
				workspaceId="ws-1"
				agentId="a-1"
				activeConversationId={null}
				onSelect={() => {}}
			/>,
		);
		expect(screen.getByText(/boom: fetch failed/)).toBeInTheDocument();
	});
});
