import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyAuditRecord } from "@/lib/schemas";

type AuditState = {
	data: PolicyAuditRecord[] | undefined;
	error: Error | null;
	isLoading: boolean;
	isError: boolean;
};

const auditState: AuditState = {
	data: undefined,
	error: null,
	isLoading: false,
	isError: false,
};

vi.mock("@/hooks/useRlac", () => ({
	usePolicyAudit: () => ({
		data: auditState.data,
		error: auditState.error,
		isLoading: auditState.isLoading,
		isError: auditState.isError,
	}),
}));

import { PolicyAuditPanel } from "./PolicyAuditPanel";

function makeRow(
	overrides: Partial<PolicyAuditRecord> = {},
): PolicyAuditRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		auditDay: "2026-05-14",
		ts: "2026-05-14T12:00:00.000Z",
		decisionId: "00000000-0000-4000-8000-0000000000aa",
		principalId: "alice@example.com",
		knowledgeBaseId: "00000000-0000-4000-8000-000000000002",
		resourceId: "00000000-0000-4000-8000-000000000003",
		action: "get",
		decision: "allow",
		reason: "policy allow",
		compiledFilterJson: null,
		...overrides,
	};
}

beforeEach(() => {
	auditState.data = undefined;
	auditState.error = null;
	auditState.isLoading = false;
	auditState.isError = false;
});

describe("PolicyAuditPanel", () => {
	it("renders the loading state while the audit query is in flight", () => {
		auditState.isLoading = true;
		render(<PolicyAuditPanel workspace="ws-1" />);
		expect(screen.getByText("Loading audit log…")).toBeInTheDocument();
	});

	it("renders the error state when the audit query fails", () => {
		auditState.isError = true;
		auditState.error = new Error("network fell over");
		render(<PolicyAuditPanel workspace="ws-1" />);
		expect(screen.getByText("Couldn't load audit log")).toBeInTheDocument();
		expect(screen.getByText("network fell over")).toBeInTheDocument();
	});

	it("renders the empty-state copy when audit data is []", () => {
		auditState.data = [];
		render(<PolicyAuditPanel workspace="ws-1" />);
		expect(
			screen.getByText(/No policy decisions recorded yet\./),
		).toBeInTheDocument();
		// Card header subtitle also calls out the no-decisions state.
		expect(screen.getByText(/No decisions recorded yet\./)).toBeInTheDocument();
	});

	it("renders the table headers and one row per decision variant", () => {
		auditState.data = [
			makeRow({
				decisionId: "00000000-0000-4000-8000-000000000010",
				decision: "allow",
				resourceId: "00000000-0000-4000-8000-000000000020",
				action: "get",
				reason: "policy allow",
			}),
			makeRow({
				decisionId: "00000000-0000-4000-8000-000000000011",
				decision: "deny",
				resourceId: "*",
				action: "list",
				reason: "no principal",
				principalId: null,
			}),
			makeRow({
				decisionId: "00000000-0000-4000-8000-000000000012",
				decision: "filter",
				resourceId: "00000000-0000-4000-8000-000000000021",
				action: "search",
				reason: "filtered set",
			}),
		];
		render(<PolicyAuditPanel workspace="ws-1" />);

		for (const header of [
			"When",
			"Principal",
			"Action",
			"Decision",
			"Resource",
			"Reason",
		]) {
			expect(screen.getByText(header)).toBeInTheDocument();
		}

		// Each DecisionBadge variant renders its label in lowercase.
		expect(screen.getByText("allow")).toBeInTheDocument();
		expect(screen.getByText("deny")).toBeInTheDocument();
		expect(screen.getByText("filter")).toBeInTheDocument();

		// `resourceId === "*"` renders as the literal "list" placeholder
		// in the resource column; the action column also shows the string
		// "list" for the deny row, so both occurrences are expected.
		expect(screen.getAllByText("list")).toHaveLength(2);
		// Two non-"*" resource ids in the fixture both slice to the same
		// 8-char prefix + ellipsis, so use getAllByText.
		expect(screen.getAllByText(/00000000…/)).toHaveLength(2);

		// Null principal renders the "<none>" fallback.
		expect(screen.getByText("<none>")).toBeInTheDocument();

		// Subtitle reports the row count.
		expect(screen.getByText(/Most recent 3\./)).toBeInTheDocument();
	});
});
