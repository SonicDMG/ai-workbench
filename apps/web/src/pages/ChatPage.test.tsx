import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/schemas";

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
		api: { getWorkspace: vi.fn() },
		ApiError,
		formatApiError: (err: unknown) =>
			err instanceof Error ? err.message : "Unknown error",
	};
});

import { api } from "@/lib/api";
import { ChatPage } from "./ChatPage";

const workspace: Workspace = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	name: "prod",
	url: "env:ASTRA_DB_API_ENDPOINT",
	kind: "astra",
	credentials: { token: "env:ASTRA_DB_APPLICATION_TOKEN" },
	keyspace: "default_keyspace",
	createdAt: "2026-04-22T10:11:12.345Z",
	updatedAt: "2026-04-22T10:11:12.345Z",
};

function renderAt(path: string) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
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
	it("renders the placeholder layout once the workspace loads", async () => {
		vi.mocked(api.getWorkspace).mockResolvedValueOnce(workspace);

		renderAt(`/workspaces/${workspace.workspaceId}/chat`);

		await waitFor(() =>
			expect(
				screen.getByRole("heading", { name: /Chat with Bobbie/i }),
			).toBeInTheDocument(),
		);
		// Placeholder pieces of the chat surface.
		expect(
			screen.getByTestId("chat-conversation-list-placeholder"),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /New chat/i })).toBeDisabled();
		expect(
			screen.getByRole("textbox", { name: /send a message/i }),
		).toBeDisabled();
		expect(screen.getByRole("button", { name: /^Send$/i })).toBeDisabled();
		// Workspace name surfaces in the subtitle and the back link.
		expect(
			screen.getByRole("link", { name: new RegExp(workspace.name) }),
		).toHaveAttribute("href", `/workspaces/${workspace.workspaceId}`);
	});

	it("surfaces an error state when the workspace cannot be loaded", async () => {
		vi.mocked(api.getWorkspace).mockRejectedValueOnce(new Error("boom"));

		renderAt(`/workspaces/${workspace.workspaceId}/chat`);

		await waitFor(() =>
			expect(screen.getByText(/Couldn't load workspace/i)).toBeInTheDocument(),
		);
		expect(
			screen.getByRole("link", { name: /back to workspaces/i }),
		).toHaveAttribute("href", "/");
	});
});
