import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteDialog } from "./DeleteDialog";

function renderDialog(props: Partial<Parameters<typeof DeleteDialog>[0]> = {}) {
	const onOpenChange = props.onOpenChange ?? vi.fn();
	const onConfirm = props.onConfirm ?? vi.fn();
	render(
		<DeleteDialog
			open
			onOpenChange={onOpenChange}
			workspaceName="research-lab"
			onConfirm={onConfirm}
			{...props}
		/>,
	);
	return { onOpenChange, onConfirm };
}

describe("DeleteDialog", () => {
	it("keeps the destructive button disabled until the workspace name is typed exactly", async () => {
		const user = userEvent.setup();
		const { onConfirm } = renderDialog();

		const button = screen.getByRole("button", { name: "Delete workspace" });
		expect(button).toBeDisabled();

		// Partial / wrong input does not arm the button.
		const input = screen.getByLabelText(/Type/);
		await user.type(input, "research-la");
		expect(button).toBeDisabled();

		await user.type(input, "b");
		expect(button).toBeEnabled();

		await user.click(button);
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("does not arm the destructive button on case-mismatched input", async () => {
		const user = userEvent.setup();
		renderDialog();
		await user.type(screen.getByLabelText(/Type/), "RESEARCH-LAB");
		expect(
			screen.getByRole("button", { name: "Delete workspace" }),
		).toBeDisabled();
	});

	it("calls onOpenChange(false) when Cancel is clicked", async () => {
		const user = userEvent.setup();
		const { onOpenChange, onConfirm } = renderDialog();
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("shows the in-flight label and disables both buttons while submitting", () => {
		renderDialog({ submitting: true });
		// Even after typing the right value, submitting locks the button.
		const button = screen.getByRole("button", { name: "Deleting…" });
		expect(button).toBeDisabled();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
	});
});
