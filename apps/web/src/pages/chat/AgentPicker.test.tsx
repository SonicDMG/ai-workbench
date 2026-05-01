import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "@/lib/schemas";
import { AgentPicker } from "./AgentPicker";

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		agentId: `agent-${Math.random()}`,
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

function renderInRouter(node: React.ReactNode) {
	return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("AgentPicker", () => {
	it("renders nothing when there are zero agents", () => {
		const { container } = renderInRouter(
			<AgentPicker
				agents={[]}
				activeAgentId=""
				onSelect={() => {}}
				workspaceId="ws-1"
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("shows just the agent name (not a select) when there's exactly one agent", () => {
		renderInRouter(
			<AgentPicker
				agents={[makeAgent({ name: "Solo" })]}
				activeAgentId="solo-id"
				onSelect={() => {}}
				workspaceId="ws-1"
			/>,
		);
		expect(screen.getByText("Solo")).toBeInTheDocument();
		expect(screen.queryByTestId("agent-picker")).not.toBeInTheDocument();
		// Manage agents link present in both branches.
		expect(screen.getByRole("link", { name: /Manage agents/ })).toHaveAttribute(
			"href",
			"/workspaces/ws-1/agents",
		);
	});

	it("renders a select with every agent when there are multiple", () => {
		const a = makeAgent({ agentId: "a-1", name: "Alpha" });
		const b = makeAgent({ agentId: "a-2", name: "Beta" });
		renderInRouter(
			<AgentPicker
				agents={[a, b]}
				activeAgentId="a-1"
				onSelect={() => {}}
				workspaceId="ws-1"
			/>,
		);
		const select = screen.getByTestId("agent-picker") as HTMLSelectElement;
		expect(select.value).toBe("a-1");
		// Both agent names land as <option> children.
		expect(screen.getByRole("option", { name: "Alpha" })).toBeInTheDocument();
		expect(screen.getByRole("option", { name: "Beta" })).toBeInTheDocument();
	});

	it("calls onSelect with the selected agent id when the user picks one", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		renderInRouter(
			<AgentPicker
				agents={[
					makeAgent({ agentId: "a-1", name: "Alpha" }),
					makeAgent({ agentId: "a-2", name: "Beta" }),
				]}
				activeAgentId="a-1"
				onSelect={onSelect}
				workspaceId="ws-1"
			/>,
		);
		await user.selectOptions(screen.getByTestId("agent-picker"), "a-2");
		expect(onSelect).toHaveBeenCalledWith("a-2");
	});
});
