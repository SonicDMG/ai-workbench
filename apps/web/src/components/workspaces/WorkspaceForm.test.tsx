import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceForm } from "./WorkspaceForm";

describe("WorkspaceForm", () => {
	it("surfaces credential validation errors that prevent submit", async () => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(<WorkspaceForm mode="create" kind="astra" onSubmit={onSubmit} />);

		await user.type(screen.getByLabelText(/Name/), "prod");
		await user.clear(screen.getByPlaceholderText("env:ASTRA_TOKEN"));
		await user.type(
			screen.getByPlaceholderText("env:ASTRA_TOKEN"),
			"plain-token",
		);
		await user.click(screen.getByRole("button", { name: /Create workspace/ }));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Expected '<provider>:<path>', e.g. 'env:FOO'",
		);
	});

	it("surfaces other validation errors that prevent submit", async () => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(<WorkspaceForm mode="create" kind="astra" onSubmit={onSubmit} />);

		await user.click(screen.getByRole("button", { name: /Create workspace/ }));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
	});
});
