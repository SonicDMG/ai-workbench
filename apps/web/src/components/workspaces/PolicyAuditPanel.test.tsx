/**
 * Behaviour tests for PolicyAuditPanel.
 *
 * The panel is a read-only audit surface, so the "behavior" is the
 * mapping from useRlac.usePolicyAudit() state → rendered DOM:
 *   - loading shimmer
 *   - error state with the underlying error message
 *   - empty state when zero decisions are recorded
 *   - table with one row per decision, badge variants per decision
 *   - resourceId="*" rendering as a "list" placeholder
 *   - null principalId rendering as "<none>"
 *   - header subtitle reporting "Most recent N."
 */

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
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("renders the error state with the underlying message", () => {
		auditState.isError = true;
		auditState.error = new Error("network fell over");
		render(<PolicyAuditPanel workspace="ws-1" />);
		expect(screen.getByText("Couldn't load audit log")).toBeInTheDocument();
		expect(screen.getByText("network fell over")).toBeInTheDocument();
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("renders the empty-state copy when audit data is []", () => {
		auditState.data = [];
		render(<PolicyAuditPanel workspace="ws-1" />);
		expect(
			screen.getByText(/No policy decisions recorded yet\./),
		).toBeInTheDocument();
		expect(screen.getByText(/No decisions recorded yet\./)).toBeInTheDocument();
		expect(screen.queryByRole("table")).toBeNull();
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

		expect(screen.getByText("allow")).toBeInTheDocument();
		expect(screen.getByText("deny")).toBeInTheDocument();
		expect(screen.getByText("filter")).toBeInTheDocument();

		// `resourceId === "*"` renders as the literal "list" placeholder
		// in the resource column; the action column also shows "list"
		// for the deny row, so both occurrences are expected.
		expect(screen.getAllByText("list")).toHaveLength(2);
		// Two non-"*" resource ids both slice to the same 8-char prefix.
		expect(screen.getAllByText(/00000000…/)).toHaveLength(2);

		expect(screen.getByText("<none>")).toBeInTheDocument();
		expect(screen.getByText(/Most recent 3\./)).toBeInTheDocument();
	});

	it("renders distinct color classes for allow / deny / filter badges", () => {
		auditState.data = [
			makeRow({
				decisionId: "00000000-0000-4000-8000-000000000010",
				decision: "allow",
				resourceId: "00000000-0000-4000-8000-000000000020",
			}),
			makeRow({
				decisionId: "00000000-0000-4000-8000-000000000011",
				decision: "deny",
				resourceId: "00000000-0000-4000-8000-000000000021",
			}),
			makeRow({
				decisionId: "00000000-0000-4000-8000-000000000012",
				decision: "filter",
				resourceId: "00000000-0000-4000-8000-000000000022",
			}),
		];
		render(<PolicyAuditPanel workspace="ws-1" />);
		// Each badge's color class is the load-bearing visual distinction;
		// asserting on the class catches a future refactor that drops the
		// allow/deny/filter palette by accident.
		expect(screen.getByText("allow").className).toMatch(/green/);
		expect(screen.getByText("deny").className).toMatch(/red/);
		expect(screen.getByText("filter").className).toMatch(/amber/);
	});
});
