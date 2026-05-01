import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "@/lib/schemas";

const createState = {
	mutateAsync: vi.fn<(input: unknown) => Promise<AgentRecord>>(),
	isPending: false,
};

vi.mock("@/hooks/useConversations", () => ({
	useCreateAgent: () => ({
		mutateAsync: createState.mutateAsync,
		isPending: createState.isPending,
	}),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

import { CreateFirstAgent } from "./CreateFirstAgent";

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		agentId: "agent-1",
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

beforeEach(() => {
	createState.mutateAsync = vi.fn();
	createState.isPending = false;
});

describe("CreateFirstAgent", () => {
	it("renders the empty-state copy and a disabled Create button when name is empty", () => {
		render(<CreateFirstAgent workspaceId="ws-1" onCreated={() => {}} />);
		expect(screen.getByText("Create your first agent")).toBeInTheDocument();
		const button = screen.getByRole("button", { name: /Create agent/ });
		expect(button).toBeDisabled();
	});

	it("enables the Create button once a non-blank name is entered", async () => {
		const user = userEvent.setup();
		render(<CreateFirstAgent workspaceId="ws-1" onCreated={() => {}} />);
		await user.type(screen.getByLabelText("Name"), "Bobbie");
		expect(
			screen.getByRole("button", { name: /Create agent/ }),
		).not.toBeDisabled();
	});

	it("submits the trimmed name + system prompt and forwards the new agentId", async () => {
		const user = userEvent.setup();
		const created = makeAgent({ agentId: "newly-created", name: "Bobbie" });
		createState.mutateAsync = vi.fn().mockResolvedValue(created);
		const onCreated = vi.fn();

		render(<CreateFirstAgent workspaceId="ws-1" onCreated={onCreated} />);
		await user.type(screen.getByLabelText("Name"), "  Bobbie  ");
		await user.type(screen.getByLabelText(/System prompt/), "  Be helpful  ");
		await user.click(screen.getByRole("button", { name: /Create agent/ }));

		await waitFor(() => {
			expect(createState.mutateAsync).toHaveBeenCalledWith({
				name: "Bobbie",
				systemPrompt: "Be helpful",
			});
		});
		expect(onCreated).toHaveBeenCalledWith("newly-created");
	});

	it("sends a null systemPrompt when the textarea is left empty", async () => {
		const user = userEvent.setup();
		createState.mutateAsync = vi
			.fn()
			.mockResolvedValue(makeAgent({ agentId: "x" }));
		render(<CreateFirstAgent workspaceId="ws-1" onCreated={() => {}} />);
		await user.type(screen.getByLabelText("Name"), "Bobbie");
		await user.click(screen.getByRole("button", { name: /Create agent/ }));
		await waitFor(() => {
			expect(createState.mutateAsync).toHaveBeenCalledWith({
				name: "Bobbie",
				systemPrompt: null,
			});
		});
	});

	it("shows the pending button label while the mutation is in flight", () => {
		createState.isPending = true;
		render(<CreateFirstAgent workspaceId="ws-1" onCreated={() => {}} />);
		expect(screen.getByRole("button", { name: /Creating…/ })).toBeDisabled();
	});
});
