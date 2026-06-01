import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
		owned: true,
		policyDsl: null,
		policyEnabled: false,
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
			// Empty selection → the "all built-in tools" default.
			toolIds: [],
			rerankEnabled: false,
			rerankingServiceId: null,
			rerankMaxResults: null,
		});
	});

	const sampleTools = [
		{
			id: "search_kb",
			description: "Semantic search across KBs.",
			source: "builtin" as const,
		},
		{
			id: "native:fetch",
			description: "GET/POST a URL.",
			source: "native" as const,
		},
	];

	it("hides the tool picker when no tools are available", () => {
		render(
			<AgentForm
				mode="create"
				knowledgeBases={[]}
				llmServices={[]}
				rerankingServices={[]}
				onSubmit={vi.fn()}
			/>,
		);
		expect(screen.queryByText("Tools")).not.toBeInTheDocument();
	});

	it("groups available tools by source and emits selected toolIds", async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(
			<AgentForm
				mode="create"
				knowledgeBases={[]}
				llmServices={[]}
				rerankingServices={[]}
				availableTools={sampleTools}
				onSubmit={onSubmit}
			/>,
		);

		// Grouped by source — both groups present.
		expect(screen.getByTestId("tool-group-builtin")).toBeInTheDocument();
		expect(screen.getByTestId("tool-group-native")).toBeInTheDocument();
		// Default hint communicates the grandfather behavior.
		expect(
			screen.getByText(/Check tools to set an explicit allow-list/),
		).toBeInTheDocument();

		await user.type(screen.getByLabelText(/^Name/), "Tooler");
		await user.click(screen.getByRole("checkbox", { name: /native:fetch/ }));
		await user.click(screen.getByRole("button", { name: /Create agent/ }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ toolIds: ["native:fetch"] }),
		);
	});

	it("sub-groups MCP tools by server label and surfaces required args (P4)", () => {
		render(
			<AgentForm
				mode="create"
				knowledgeBases={[]}
				llmServices={[]}
				rerankingServices={[]}
				availableTools={[
					{ id: "search_kb", description: "b", source: "builtin" as const },
					{
						id: "mcp:srv-1:echo",
						description: "Echo.",
						source: "mcp" as const,
						serverId: "srv-1",
						serverLabel: "Acme Tools",
						inputSchema: { type: "object", required: ["message"] },
					},
					{
						id: "mcp:srv-2:ping",
						description: "Ping.",
						source: "mcp" as const,
						serverId: "srv-2",
						serverLabel: "Ping Server",
						inputSchema: { type: "object" },
					},
				]}
				onSubmit={vi.fn()}
			/>,
		);
		// The mcp source group exists, sub-grouped per server label.
		expect(screen.getByTestId("tool-group-mcp")).toBeInTheDocument();
		expect(screen.getAllByTestId("mcp-server-group")).toHaveLength(2);
		expect(screen.getByText("Acme Tools")).toBeInTheDocument();
		expect(screen.getByText("Ping Server")).toBeInTheDocument();
		// Required args surface from the tool's inputSchema.
		expect(screen.getByText(/requires: message/)).toBeInTheDocument();
	});

	it("renders an untrusted MCP tool description as inert text, never parsed HTML (P6)", () => {
		const xss = '<img src=x onerror="alert(1)"><script>steal()</script>';
		const { container } = render(
			<AgentForm
				mode="create"
				knowledgeBases={[]}
				llmServices={[]}
				rerankingServices={[]}
				availableTools={[
					{
						id: "mcp:srv-1:evil",
						description: xss,
						source: "mcp" as const,
						serverId: "srv-1",
						serverLabel: "Untrusted Server",
						inputSchema: { type: "object" },
					},
				]}
				onSubmit={vi.fn()}
			/>,
		);
		// The payload appears verbatim as text — React escaped the angle
		// brackets, so the description is shown, not interpreted…
		expect(screen.getByText(xss)).toBeInTheDocument();
		// …and was NOT parsed into live DOM nodes (no XSS sink).
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("script")).toBeNull();
	});

	it("warns about saved tools that no longer resolve and can clear them (P4)", async () => {
		const user = userEvent.setup();
		render(
			<AgentForm
				mode="edit"
				agent={{
					workspaceId: "00000000-0000-4000-8000-000000000001",
					agentId: "00000000-0000-4000-8000-000000000ccc",
					name: "Stale",
					description: null,
					systemPrompt: null,
					userPrompt: null,
					llmServiceId: null,
					knowledgeBaseIds: [],
					// A namespaced id whose server was since removed.
					toolIds: ["search_kb", "mcp:deleted-srv:gone"],
					rerankEnabled: false,
					rerankingServiceId: null,
					rerankMaxResults: null,
					createdAt: "2026-04-01T00:00:00Z",
					updatedAt: "2026-04-01T00:00:00Z",
				}}
				knowledgeBases={[]}
				llmServices={[]}
				rerankingServices={[]}
				availableTools={sampleTools}
				onSubmit={vi.fn()}
			/>,
		);
		const warning = screen.getByTestId("dangling-tools-warning");
		expect(warning).toHaveTextContent("mcp:deleted-srv:gone");
		// `search_kb` resolves, so it isn't flagged.
		expect(warning).not.toHaveTextContent("search_kb");
		// Clearing removes the dangling id and dismisses the warning.
		await user.click(
			screen.getByRole("button", { name: /Remove unavailable tools/ }),
		);
		expect(
			screen.queryByTestId("dangling-tools-warning"),
		).not.toBeInTheDocument();
	});

	it("shows an empty-state callout + 'Add tools' link when only built-in tools exist", () => {
		render(
			<MemoryRouter>
				<AgentForm
					mode="create"
					workspaceId="ws-1"
					knowledgeBases={[]}
					llmServices={[]}
					rerankingServices={[]}
					availableTools={[
						{
							id: "search_kb",
							description: "Semantic search across KBs.",
							source: "builtin" as const,
						},
					]}
					onSubmit={vi.fn()}
				/>
			</MemoryRouter>,
		);
		// The Tools section still renders (built-in tools are present)…
		expect(screen.getByTestId("tool-group-builtin")).toBeInTheDocument();
		// …and a callout nudges the user to register external tools.
		expect(
			screen.getByText(/No external tools are registered/),
		).toBeInTheDocument();
		// The shortcut(s) deep-link to the workspace's settings page.
		const settingsLinks = screen
			.getAllByRole("link")
			.filter((a) =>
				a.getAttribute("href")?.includes("/workspaces/ws-1/settings"),
			);
		expect(settingsLinks.length).toBeGreaterThan(0);
	});

	it("preselects the agent's existing toolIds in edit mode", () => {
		render(
			<AgentForm
				mode="edit"
				agent={{
					workspaceId: "00000000-0000-4000-8000-000000000001",
					agentId: "00000000-0000-4000-8000-000000000bbb",
					name: "Existing",
					description: null,
					systemPrompt: null,
					userPrompt: null,
					llmServiceId: null,
					knowledgeBaseIds: [],
					toolIds: ["search_kb"],
					rerankEnabled: false,
					rerankingServiceId: null,
					rerankMaxResults: null,
					createdAt: "2026-04-01T00:00:00Z",
					updatedAt: "2026-04-01T00:00:00Z",
				}}
				knowledgeBases={[]}
				llmServices={[]}
				rerankingServices={[]}
				availableTools={sampleTools}
				onSubmit={vi.fn()}
			/>,
		);
		expect(screen.getByRole("checkbox", { name: /search_kb/ })).toBeChecked();
		expect(
			screen.getByRole("checkbox", { name: /native:fetch/ }),
		).not.toBeChecked();
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
					toolIds: [],
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
