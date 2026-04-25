import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KindBadge } from "./KindBadge";

// Render smoke for the four valid workspace kinds. Locks the
// human-readable labels (which show up in lists, dialogs, and the
// playground picker) so future renames are intentional.
describe("KindBadge", () => {
	it.each([
		["astra", "Astra"],
		["mock", "Mock"],
		["hcd", "HCD"],
		["openrag", "OpenRAG"],
	] as const)("renders %s as %s", (kind, label) => {
		render(<KindBadge kind={kind} />);
		expect(screen.getByText(label)).toBeInTheDocument();
	});

	it("forwards extra className onto the root span", () => {
		render(<KindBadge kind="astra" className="custom-x" />);
		expect(screen.getByText("Astra")).toHaveClass("custom-x");
	});
});
