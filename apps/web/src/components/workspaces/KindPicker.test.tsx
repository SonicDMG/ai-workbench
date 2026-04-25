import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KindPicker } from "./KindPicker";

describe("KindPicker", () => {
	it("renders all four kinds with their human labels", () => {
		render(<KindPicker value={null} onChange={() => {}} />);
		expect(
			screen.getByRole("button", { name: /Astra DB/ }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Mock/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /HCD/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /OpenRAG/ })).toBeInTheDocument();
	});

	it("fires onChange for active kinds", async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(<KindPicker value={null} onChange={onChange} />);

		await user.click(screen.getByRole("button", { name: /Astra DB/ }));
		await user.click(screen.getByRole("button", { name: /Mock/ }));

		expect(onChange).toHaveBeenCalledTimes(2);
		expect(onChange).toHaveBeenNthCalledWith(1, "astra");
		expect(onChange).toHaveBeenNthCalledWith(2, "mock");
	});

	it("marks hcd and openrag as coming-soon and blocks selection", async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(<KindPicker value={null} onChange={onChange} />);

		const hcd = screen.getByRole("button", { name: /HCD/ });
		const openrag = screen.getByRole("button", { name: /OpenRAG/ });

		expect(hcd).toBeDisabled();
		expect(openrag).toBeDisabled();
		// Both tiles surface the affordance visibly.
		expect(screen.getAllByText("Coming soon")).toHaveLength(2);

		// userEvent honors `disabled` and silently skips the click.
		await user.click(hcd);
		await user.click(openrag);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("does not surface a coming-soon pill on active kinds", () => {
		render(<KindPicker value={null} onChange={() => {}} />);
		const astra = screen.getByRole("button", { name: /Astra DB/ });
		const mock = screen.getByRole("button", { name: /Mock/ });
		expect(astra).not.toBeDisabled();
		expect(mock).not.toBeDisabled();
		// Recommended pill belongs only to astra.
		expect(screen.getByText("Recommended")).toBeInTheDocument();
	});
});
