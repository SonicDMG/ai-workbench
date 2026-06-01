import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
	api: { listPolicyAudit: vi.fn() },
	formatApiError: (e: unknown) => (e instanceof Error ? e.message : "err"),
}));

import { api } from "@/lib/api";
import type { PolicyAuditEntry } from "@/lib/schemas";
import { PolicyAuditPanel } from "./PolicyAuditPanel";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const WS = "00000000-0000-4000-8000-000000000001";

function entry(overrides: Partial<PolicyAuditEntry>): PolicyAuditEntry {
	return {
		workspaceId: WS,
		auditDay: "2026-06-01",
		ts: "2026-06-01T12:00:00.000Z",
		decisionId: crypto.randomUUID(),
		principalId: "alice",
		knowledgeBaseId: "00000000-0000-4000-8000-000000000002",
		resourceId: "doc-1",
		action: "list",
		decision: "filter",
		reason: "filtered by visibility",
		compiledFilterJson: null,
		...overrides,
	};
}

describe("PolicyAuditPanel", () => {
	it("shows the empty state when no decisions exist", async () => {
		vi.mocked(api.listPolicyAudit).mockResolvedValue([]);
		render(<PolicyAuditPanel workspace={WS} />, { wrapper });
		expect(
			await screen.findByText("No decisions recorded yet"),
		).toBeInTheDocument();
	});

	it("renders recent decisions with principal and decision", async () => {
		vi.mocked(api.listPolicyAudit).mockResolvedValue([
			entry({ principalId: "alice", decision: "filter", action: "search" }),
			entry({ principalId: "bob", decision: "deny", action: "delete" }),
		]);
		render(<PolicyAuditPanel workspace={WS} />, { wrapper });
		expect(await screen.findByText("alice")).toBeInTheDocument();
		expect(screen.getByText("bob")).toBeInTheDocument();
		expect(screen.getByText("filter")).toBeInTheDocument();
		expect(screen.getByText("deny")).toBeInTheDocument();
	});
});
