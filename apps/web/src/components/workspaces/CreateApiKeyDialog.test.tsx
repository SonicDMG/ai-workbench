import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn();
const reset = vi.fn();

vi.mock("@/hooks/useApiKeys", () => ({
	useCreateApiKey: () => ({
		mutateAsync,
		reset,
		isPending: false,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

import { toast } from "sonner";
import { CreateApiKeyDialog } from "./CreateApiKeyDialog";

describe("CreateApiKeyDialog", () => {
	beforeEach(() => {
		mutateAsync.mockReset();
		reset.mockReset();
		vi.mocked(toast.success).mockReset();
		vi.mocked(toast.error).mockReset();
	});

	it("creates a trimmed API key label and reveals plaintext exactly once", async () => {
		mutateAsync.mockResolvedValue({
			plaintext: "wb_test_fake_key_for_ui_reveal",
			key: {
				label: "ci",
			},
		});
		const onOpenChange = vi.fn();
		const user = userEvent.setup();

		render(
			<CreateApiKeyDialog
				workspace="00000000-0000-4000-8000-000000000001"
				open
				onOpenChange={onOpenChange}
			/>,
		);

		await user.type(screen.getByLabelText("Label"), "  ci  ");
		await user.click(screen.getByRole("button", { name: "Create key" }));

		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith({ label: "ci" }),
		);
		expect(await screen.findByText("Copy your key now")).toBeInTheDocument();
		expect(
			screen.getByText("wb_test_fake_key_for_ui_reveal"),
		).toBeInTheDocument();
		expect(toast.success).toHaveBeenCalledWith("API key 'ci' created");
	});

	it("keeps submit disabled until a nonblank label is entered", async () => {
		const user = userEvent.setup();
		render(
			<CreateApiKeyDialog
				workspace="00000000-0000-4000-8000-000000000001"
				open
				onOpenChange={() => {}}
			/>,
		);

		const submit = screen.getByRole("button", { name: "Create key" });
		expect(submit).toBeDisabled();
		await user.type(screen.getByLabelText("Label"), "notebook");
		expect(submit).toBeEnabled();
	});
});
