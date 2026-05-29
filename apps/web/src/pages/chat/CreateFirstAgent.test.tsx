import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "@/lib/schemas";

const createState = {
	mutateAsync: vi.fn<(input: unknown) => Promise<AgentRecord>>(),
	isPending: false,
};

// CustomAgentForm now renders the shared AgentForm, which reads the
// workspace's KB / LLM / reranking / tool catalogs. Stub them all to
// empty so the form renders without network and the tool picker stays
// hidden (no catalogs → the form is just name + prompt + reranking).
vi.mock("@/hooks/useConversations", () => ({
	useCreateAgent: () => ({
		mutateAsync: createState.mutateAsync,
		isPending: createState.isPending,
	}),
	useLlmServices: () => ({ data: [] }),
	useAvailableTools: () => ({ data: [] }),
}));

vi.mock("@/hooks/useKnowledgeBases", () => ({
	useKnowledgeBases: () => ({ data: [] }),
}));

vi.mock("@/hooks/useServices", () => ({
	useRerankingServices: () => ({ data: [] }),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

// We drive the custom-form path directly; the wrapper defaults to the
// AgentTemplateGallery view (covered by its own tests). Both paths
// share the create-agent mutation and toast wiring.
import { CustomAgentForm as CreateFirstAgent } from "./CreateFirstAgent";

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		agentId: "agent-1",
		name: "Bobby",
		description: null,
		systemPrompt: null,
		userPrompt: null,
		llmServiceId: null,
		knowledgeBaseIds: [],
		toolIds: [],
		rerankEnabled: false,
		rerankingServiceId: null,
		rerankMaxResults: null,
		createdAt: "2026-04-25T10:00:00.000Z",
		updatedAt: "2026-04-25T10:00:00.000Z",
		...overrides,
	};
}

function renderForm(props: {
	workspaceId?: string;
	onCreated?: (id: string) => void;
}) {
	return render(
		<MemoryRouter>
			<CreateFirstAgent
				workspaceId={props.workspaceId ?? "ws-1"}
				onCreated={props.onCreated ?? (() => {})}
			/>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	createState.mutateAsync = vi.fn();
	createState.isPending = false;
});

describe("CreateFirstAgent (custom form)", () => {
	it("renders the shared agent form with a Create button", () => {
		renderForm({});
		expect(screen.getByText("Create your first agent")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Create agent/ }),
		).toBeInTheDocument();
	});

	it("blocks submit and surfaces a validation error when the name is blank", async () => {
		const user = userEvent.setup();
		renderForm({});
		await user.click(screen.getByRole("button", { name: /Create agent/ }));
		expect(createState.mutateAsync).not.toHaveBeenCalled();
		expect(await screen.findByText("Name is required")).toBeInTheDocument();
	});

	it("submits the full agent payload and forwards the new agentId", async () => {
		const user = userEvent.setup();
		const created = makeAgent({ agentId: "newly-created", name: "Bobby" });
		createState.mutateAsync = vi.fn().mockResolvedValue(created);
		const onCreated = vi.fn();

		renderForm({ onCreated });
		await user.type(screen.getByLabelText(/^Name/), "  Bobby  ");
		await user.type(screen.getByLabelText(/System prompt/), "  Be helpful  ");
		await user.click(screen.getByRole("button", { name: /Create agent/ }));

		await waitFor(() => {
			expect(createState.mutateAsync).toHaveBeenCalledWith({
				name: "Bobby",
				description: null,
				systemPrompt: "Be helpful",
				llmServiceId: null,
				knowledgeBaseIds: [],
				toolIds: [],
				rerankEnabled: false,
				rerankingServiceId: null,
				rerankMaxResults: null,
			});
		});
		expect(onCreated).toHaveBeenCalledWith("newly-created");
	});

	it("sends a null systemPrompt when the prompt is left empty", async () => {
		const user = userEvent.setup();
		createState.mutateAsync = vi
			.fn()
			.mockResolvedValue(makeAgent({ agentId: "x" }));
		renderForm({});
		await user.type(screen.getByLabelText(/^Name/), "Bobby");
		await user.click(screen.getByRole("button", { name: /Create agent/ }));
		await waitFor(() => {
			expect(createState.mutateAsync).toHaveBeenCalledWith(
				expect.objectContaining({ name: "Bobby", systemPrompt: null }),
			);
		});
	});

	it("shows the pending button label while the mutation is in flight", () => {
		createState.isPending = true;
		renderForm({});
		expect(screen.getByRole("button", { name: /Saving…/ })).toBeDisabled();
	});
});
