import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SearchHit } from "@/lib/schemas";
import { ResultsTable } from "./ResultsTable";

const HIT_WITH_PAYLOAD: SearchHit = {
	id: "chunk-1",
	score: 0.872541,
	payload: {
		chunkIndex: 3,
		documentId: "doc-42",
		chunkText: "The cat sat on the mat near the window.",
		extra: "ignored-by-row-summary",
	},
};

const HIT_WITHOUT_TEXT: SearchHit = {
	id: "chunk-2",
	score: 0.5,
	payload: { chunkIndex: 1 },
};

describe("ResultsTable", () => {
	it("renders nothing when the user has not run a query yet", () => {
		const { container } = render(<ResultsTable hits={null} loading={false} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders a Searching… placeholder while the first query is in flight", () => {
		render(<ResultsTable hits={null} loading />);
		expect(screen.getByText("Searching…")).toBeInTheDocument();
	});

	it("renders the empty state when results are an empty array", () => {
		render(<ResultsTable hits={[]} loading={false} />);
		expect(screen.getByText("No matches.")).toBeInTheDocument();
	});

	it("surfaces chunkIndex, documentId, chunkText, and a 4-decimal score in the row summary", () => {
		render(<ResultsTable hits={[HIT_WITH_PAYLOAD]} loading={false} />);
		expect(screen.getByText("#3")).toBeInTheDocument();
		expect(screen.getByText("doc-42")).toBeInTheDocument();
		expect(
			screen.getByText("The cat sat on the mat near the window."),
		).toBeInTheDocument();
		// Score is rendered fixed to 4 decimals.
		expect(screen.getByText("0.8725")).toBeInTheDocument();
	});

	it("falls back to the hit id and an explanatory note when chunkText is missing", () => {
		render(<ResultsTable hits={[HIT_WITHOUT_TEXT]} loading={false} />);
		expect(screen.getByText("chunk-2")).toBeInTheDocument();
		expect(
			screen.getByText(/text not stored on this chunk's payload/i),
		).toBeInTheDocument();
	});

	it("expands a row to show the full payload JSON when clicked", async () => {
		const user = userEvent.setup();
		render(<ResultsTable hits={[HIT_WITH_PAYLOAD]} loading={false} />);

		// The row summary truncates payload — extra keys aren't visible
		// until expansion. Expand and assert the JSON pre block contains
		// the full record.
		await user.click(screen.getByRole("button"));
		const pre = screen.getByText((_, node) => node?.tagName === "PRE");
		expect(pre.textContent).toContain('"id": "chunk-1"');
		expect(pre.textContent).toContain('"score": 0.872541');
		expect(pre.textContent).toContain('"extra": "ignored-by-row-summary"');
	});
});
