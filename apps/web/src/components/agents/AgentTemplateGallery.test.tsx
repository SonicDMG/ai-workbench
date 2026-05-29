import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AgentRecord, AgentTemplate } from "@/lib/schemas";

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/lib/api", () => ({
	api: {
		listAgentTemplates: vi.fn(),
		createAgentFromTemplate: vi.fn(),
	},
	ApiError: class ApiError extends Error {},
	formatApiError: (e: unknown) =>
		e instanceof Error ? e.message : "unexpected error",
}));

import { api } from "@/lib/api";
import { AgentTemplateGallery } from "./AgentTemplateGallery";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

const TEMPLATES: AgentTemplate[] = [
	{
		templateId: "bobby",
		name: "Bobby",
		description: "Direct data analyst",
		persona: "Direct, professional, terse.",
		systemPrompt: "You are Bobby.",
		defaultOnNewWorkspace: true,
	},
	{
		templateId: "maven",
		name: "Maven",
		description: "Research synthesizer",
		persona: "Thorough and methodical.",
		systemPrompt: "You are Maven.",
		defaultOnNewWorkspace: false,
	},
];

const AGENT_RECORD: AgentRecord = {
	workspaceId: WORKSPACE_ID,
	agentId: "00000000-0000-4000-8000-00000000aaaa",
	name: "Maven",
	description: "Research synthesizer",
	systemPrompt: "You are Maven.",
	userPrompt: null,
	llmServiceId: null,
	knowledgeBaseIds: [],
	toolIds: [],
	rerankEnabled: false,
	rerankingServiceId: null,
	rerankMaxResults: null,
	createdAt: "2026-05-04T12:00:00.000Z",
	updatedAt: "2026-05-04T12:00:00.000Z",
};

describe("AgentTemplateGallery", () => {
	it("renders one card per template after the catalog loads", async () => {
		vi.mocked(api.listAgentTemplates).mockResolvedValueOnce(TEMPLATES);
		render(<AgentTemplateGallery workspaceId={WORKSPACE_ID} />, { wrapper });

		expect(await screen.findByText("Bobby")).toBeInTheDocument();
		expect(screen.getByText("Maven")).toBeInTheDocument();
		expect(api.listAgentTemplates).toHaveBeenCalledWith(WORKSPACE_ID);
	});

	it("badges default-on templates as Recommended", async () => {
		vi.mocked(api.listAgentTemplates).mockResolvedValueOnce(TEMPLATES);
		render(<AgentTemplateGallery workspaceId={WORKSPACE_ID} />, { wrapper });

		await screen.findByText("Bobby");
		// Bobby is default-on; Maven is not.
		const recommended = screen.getAllByText(/Recommended/);
		expect(recommended.length).toBe(1);
	});

	it("hides the Recommended badge when hideRecommendedBadge is set", async () => {
		vi.mocked(api.listAgentTemplates).mockResolvedValueOnce(TEMPLATES);
		render(
			<AgentTemplateGallery workspaceId={WORKSPACE_ID} hideRecommendedBadge />,
			{ wrapper },
		);

		await screen.findByText("Bobby");
		expect(screen.queryByText(/Recommended/)).not.toBeInTheDocument();
	});

	it("flags templates whose name matches an existing agent as Already added", async () => {
		vi.mocked(api.listAgentTemplates).mockResolvedValueOnce(TEMPLATES);
		render(
			<AgentTemplateGallery
				workspaceId={WORKSPACE_ID}
				existingAgents={[{ name: "Bobby" }]}
			/>,
			{ wrapper },
		);

		await screen.findByText("Bobby");
		expect(screen.getByText(/^Added$/)).toBeInTheDocument();
		const bobbyAddBtn = screen.getByRole("button", { name: /Add Bobby/ });
		expect(bobbyAddBtn).toBeDisabled();
		// Maven is not in the existing list — its Add button stays enabled.
		expect(screen.getByRole("button", { name: /Add Maven/ })).toBeEnabled();
	});

	it("name match is case-insensitive and trims whitespace", async () => {
		vi.mocked(api.listAgentTemplates).mockResolvedValueOnce(TEMPLATES);
		render(
			<AgentTemplateGallery
				workspaceId={WORKSPACE_ID}
				existingAgents={[{ name: "  bobby  " }]}
			/>,
			{ wrapper },
		);
		await screen.findByText("Bobby");
		expect(screen.getByRole("button", { name: /Add Bobby/ })).toBeDisabled();
	});

	it("invokes onAdded with the new agent after a successful instantiation", async () => {
		vi.mocked(api.listAgentTemplates).mockResolvedValueOnce(TEMPLATES);
		vi.mocked(api.createAgentFromTemplate).mockResolvedValueOnce(AGENT_RECORD);
		const onAdded = vi.fn();
		const user = userEvent.setup();

		render(
			<AgentTemplateGallery workspaceId={WORKSPACE_ID} onAdded={onAdded} />,
			{ wrapper },
		);
		await user.click(await screen.findByRole("button", { name: /Add Maven/ }));

		await waitFor(() => expect(onAdded).toHaveBeenCalledWith(AGENT_RECORD));
		expect(api.createAgentFromTemplate).toHaveBeenCalledWith(
			WORKSPACE_ID,
			"maven",
		);
	});

	it("disables every Add button while one instantiation is in flight", async () => {
		vi.mocked(api.listAgentTemplates).mockResolvedValueOnce(TEMPLATES);
		// Block the mutation so the in-flight state is observable.
		let resolveCreate: (a: AgentRecord) => void = () => {};
		vi.mocked(api.createAgentFromTemplate).mockImplementationOnce(
			() => new Promise<AgentRecord>((r) => (resolveCreate = r)),
		);
		const user = userEvent.setup();

		render(<AgentTemplateGallery workspaceId={WORKSPACE_ID} />, { wrapper });
		await user.click(await screen.findByRole("button", { name: /Add Maven/ }));

		// Bobby's Add is disabled too, even though Bobby isn't in flight.
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /Add Bobby/ })).toBeDisabled(),
		);
		// Resolve so the mutation finishes and the test cleans up.
		resolveCreate(AGENT_RECORD);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /Add Bobby/ })).toBeEnabled(),
		);
	});

	it("renders an inline error message when the catalog fails to load", async () => {
		vi.mocked(api.listAgentTemplates).mockRejectedValueOnce(new Error("boom"));
		render(<AgentTemplateGallery workspaceId={WORKSPACE_ID} />, { wrapper });

		await waitFor(() =>
			expect(screen.getByText(/Couldn't load templates/)).toBeInTheDocument(),
		);
		expect(screen.getByText(/boom/)).toBeInTheDocument();
	});
});
