import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentForm } from "./AgentForm";

const baseKnowledgeBases = [
	{
		workspaceId: "00000000-0000-4000-8000-000000000001",
		knowledgeBaseId: "00000000-0000-4000-8000-000000000aaa",
		name: "support-docs",
		description: null,
		status: "active" as const,
		embeddingServiceId: "00000000-0000-4000-8000-000000000010",
		chunkingServiceId: "00000000-0000-4000-8000-000000000020",
		rerankingServiceId: null,
		language: null,
		lexical: { enabled: false, analyzer: null, options: {} },
		vectorCollection: "wb_vectors_kb_aaa",
		createdAt: "2026-04-01T00:00:00Z",
		updatedAt: "2026-04-01T00:00:00Z",
	},
];

describe("AgentForm", () => {
	it("blocks submit when the name is blank", async () => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(
			<AgentForm
				mode="create"
				knowledgeBases={[]}
				llmServices={[]}
				rerankingServices={[]}
				onSubmit={onSubmit}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /Create agent/ }));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(await screen.findByText("Name is required")).toBeInTheDocument();
	});

	it("emits a clean payload — null for empty optional fields, parsed numeric inputs", async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(
			<AgentForm
				mode="create"
				knowledgeBases={baseKnowledgeBases}
				llmServices={[]}
				rerankingServices={[]}
				onSubmit={onSubmit}
			/>,
		);

		await user.type(screen.getByLabelText(/^Name/), "Support assistant");
		await user.type(
			screen.getByLabelText(/Description/),
			"Helps customers with returns",
		);

		const kbToggle = screen.getByRole("checkbox", { name: /support-docs/ });
		await user.click(kbToggle);

		await user.click(screen.getByRole("button", { name: /Create agent/ }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit).toHaveBeenCalledWith({
			name: "Support assistant",
			description: "Helps customers with returns",
			systemPrompt: null,
			llmServiceId: null,
			knowledgeBaseIds: ["00000000-0000-4000-8000-000000000aaa"],
			ragEnabled: true,
			ragMaxResults: null,
			ragMinScore: null,
			rerankEnabled: false,
			rerankingServiceId: null,
			rerankMaxResults: null,
		});
	});

	it("populates from an existing agent in edit mode", () => {
		const onSubmit = vi.fn();
		render(
			<AgentForm
				mode="edit"
				agent={{
					workspaceId: "00000000-0000-4000-8000-000000000001",
					agentId: "00000000-0000-4000-8000-000000000bbb",
					name: "Existing agent",
					description: "Hello",
					systemPrompt: "You are helpful.",
					userPrompt: null,
					llmServiceId: null,
					knowledgeBaseIds: [],
					ragEnabled: false,
					ragMaxResults: null,
					ragMinScore: null,
					rerankEnabled: false,
					rerankingServiceId: null,
					rerankMaxResults: null,
					createdAt: "2026-04-01T00:00:00Z",
					updatedAt: "2026-04-01T00:00:00Z",
				}}
				knowledgeBases={[]}
				llmServices={[]}
				rerankingServices={[]}
				onSubmit={onSubmit}
			/>,
		);

		expect(screen.getByLabelText(/^Name/)).toHaveValue("Existing agent");
		expect(screen.getByLabelText(/Description/)).toHaveValue("Hello");
		expect(screen.getByLabelText(/System prompt/)).toHaveValue(
			"You are helpful.",
		);
		expect(
			screen.getByRole("button", { name: /Save changes/ }),
		).toBeInTheDocument();
	});
});
