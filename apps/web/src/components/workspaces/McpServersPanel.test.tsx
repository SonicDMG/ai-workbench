import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerRecord } from "@/lib/schemas";

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();

let rows: McpServerRecord[] = [];
let listState = { isLoading: false, isError: false };

vi.mock("@/hooks/useMcpServers", () => ({
	useMcpServers: () => ({
		isLoading: listState.isLoading,
		isError: listState.isError,
		error: new Error("boom"),
		data: rows,
	}),
	useCreateMcpServer: () => ({
		isPending: false,
		mutateAsync: createMutateAsync,
	}),
	useUpdateMcpServer: () => ({
		isPending: false,
		mutateAsync: updateMutateAsync,
	}),
	useDeleteMcpServer: () => ({
		isPending: false,
		mutateAsync: deleteMutateAsync,
	}),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

import { McpServersPanel } from "./McpServersPanel";

function server(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		mcpServerId: "11111111-2222-4333-8444-555555555555",
		label: "Docs MCP",
		url: "https://mcp.example.com/mcp",
		credentialRef: null,
		enabled: true,
		allowedTools: null,
		createdAt: "2026-05-01T00:00:00.000Z",
		updatedAt: "2026-05-01T00:00:00.000Z",
		...overrides,
	};
}

describe("McpServersPanel", () => {
	beforeEach(() => {
		rows = [server()];
		listState = { isLoading: false, isError: false };
		createMutateAsync.mockReset();
		updateMutateAsync.mockReset();
		deleteMutateAsync.mockReset();
	});

	it("renders the registered servers in a table", () => {
		render(<McpServersPanel workspace="ws-1" />);
		expect(screen.getByText("Docs MCP")).toBeInTheDocument();
		expect(screen.getByText("https://mcp.example.com/mcp")).toBeInTheDocument();
		// allowedTools=null renders the "all advertised" hint.
		expect(screen.getByText("all advertised")).toBeInTheDocument();
		expect(screen.getByText("Enabled")).toBeInTheDocument();
	});

	it("shows the empty state when no servers are registered", () => {
		rows = [];
		render(<McpServersPanel workspace="ws-1" />);
		expect(
			screen.getByText(/No external MCP servers registered/),
		).toBeInTheDocument();
	});

	it("registers a server through the add dialog", async () => {
		rows = [];
		createMutateAsync.mockResolvedValue(server());
		const user = userEvent.setup();
		render(<McpServersPanel workspace="ws-1" />);

		await user.click(screen.getByRole("button", { name: /Add MCP server/ }));
		await user.type(screen.getByLabelText(/^Label/), "Docs MCP");
		await user.type(
			screen.getByLabelText(/^URL/),
			"https://mcp.example.com/mcp",
		);
		await user.click(screen.getByRole("button", { name: /^Register$/ }));

		await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
		expect(createMutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				label: "Docs MCP",
				url: "https://mcp.example.com/mcp",
				enabled: true,
				allowedTools: null,
			}),
		);
	});

	it("rejects a non-http URL before calling the API", async () => {
		rows = [];
		const user = userEvent.setup();
		render(<McpServersPanel workspace="ws-1" />);

		await user.click(screen.getByRole("button", { name: /Add MCP server/ }));
		await user.type(screen.getByLabelText(/^Label/), "Bad");
		await user.type(screen.getByLabelText(/^URL/), "ftp://nope.example.com");
		await user.click(screen.getByRole("button", { name: /^Register$/ }));

		// Client-side schema guard fires; the mutation is never invoked.
		expect(createMutateAsync).not.toHaveBeenCalled();
	});

	it("renders an error state when the list query fails", () => {
		listState = { isLoading: false, isError: true };
		render(<McpServersPanel workspace="ws-1" />);
		expect(screen.getByText("Couldn't load MCP servers")).toBeInTheDocument();
	});
});
