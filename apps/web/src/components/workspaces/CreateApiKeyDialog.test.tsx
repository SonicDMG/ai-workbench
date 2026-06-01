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
			expect(mutateAsync).toHaveBeenCalledWith({
				label: "ci",
				// Default-selected role is Editor (read + write) — matches the
				// behavior of keys minted before the role picker existed.
				scopes: ["read", "write"],
			}),
		);
		expect(await screen.findByText("Copy your key now")).toBeInTheDocument();
		expect(
			screen.getByText("wb_test_fake_key_for_ui_reveal"),
		).toBeInTheDocument();
		expect(toast.success).toHaveBeenCalledWith("API key 'ci' created");
	});

	it("sends [read] when Viewer is picked and [read, write, manage] for Admin", async () => {
		mutateAsync.mockResolvedValue({
			plaintext: "wb_test_fake_key",
			key: { label: "k" },
		});
		const user = userEvent.setup();
		const { unmount } = render(
			<CreateApiKeyDialog
				workspace="00000000-0000-4000-8000-000000000001"
				open
				onOpenChange={() => {}}
			/>,
		);

		await user.type(screen.getByLabelText("Label"), "external-agent");
		await user.click(screen.getByRole("radio", { name: /Viewer/ }));
		await user.click(screen.getByRole("button", { name: "Create key" }));
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith({
				label: "external-agent",
				scopes: ["read"],
			}),
		);
		unmount();

		mutateAsync.mockReset();
		mutateAsync.mockResolvedValue({
			plaintext: "wb_test_fake_key",
			key: { label: "k" },
		});
		render(
			<CreateApiKeyDialog
				workspace="00000000-0000-4000-8000-000000000001"
				open
				onOpenChange={() => {}}
			/>,
		);
		await user.type(screen.getByLabelText("Label"), "admin-tool");
		await user.click(screen.getByRole("radio", { name: /Admin/ }));
		await user.click(screen.getByRole("button", { name: "Create key" }));
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith({
				label: "admin-tool",
				scopes: ["read", "write", "manage"],
			}),
		);
	});

	it("mints a custom fine-scoped key from the advanced picker", async () => {
		mutateAsync.mockResolvedValue({
			plaintext: "wb_test_fake_key",
			key: { label: "ingest-bot" },
		});
		const user = userEvent.setup();
		render(
			<CreateApiKeyDialog
				workspace="00000000-0000-4000-8000-000000000001"
				open
				onOpenChange={() => {}}
			/>,
		);

		await user.type(screen.getByLabelText("Label"), "ingest-bot");
		await user.click(screen.getByRole("radio", { name: /Custom/ }));

		// Custom mode with nothing ticked → submit stays disabled.
		const submit = screen.getByRole("button", { name: "Create key" });
		expect(submit).toBeDisabled();

		await user.click(screen.getByRole("checkbox", { name: /read:content/ }));
		await user.click(screen.getByRole("checkbox", { name: /write:ingest/ }));
		expect(submit).toBeEnabled();

		await user.click(submit);
		await waitFor(() =>
			expect(mutateAsync).toHaveBeenCalledWith({
				label: "ingest-bot",
				// Sent in tick order — exactly the fine scopes chosen, no preset.
				scopes: ["read:content", "write:ingest"],
			}),
		);
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
