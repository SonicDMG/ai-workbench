import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiKeyRecord } from "@/lib/schemas";

const refetch = vi.fn();
const revokeMutateAsync = vi.fn();

vi.mock("@/hooks/useApiKeys", () => ({
	useApiKeys: () => ({
		isLoading: false,
		isError: false,
		isFetching: false,
		data: rows,
		refetch,
	}),
	useRevokeApiKey: () => ({
		isPending: false,
		mutateAsync: revokeMutateAsync,
	}),
}));

vi.mock("./CreateApiKeyDialog", () => ({
	CreateApiKeyDialog: ({ open }: { open: boolean }) =>
		open ? <div role="dialog">Create key dialog</div> : null,
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

import { toast } from "sonner";
import { ApiKeysPanel } from "./ApiKeysPanel";

let rows: ApiKeyRecord[] = [];

function key(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		keyId: "00000000-0000-4000-8000-000000000002",
		prefix: "abcdefghijkl",
		label: "ci",
		scopes: ["read", "write"],
		createdAt: "2026-04-25T00:00:00.000Z",
		lastUsedAt: null,
		revokedAt: null,
		expiresAt: null,
		...overrides,
	};
}

describe("ApiKeysPanel", () => {
	beforeEach(() => {
		rows = [key()];
		refetch.mockReset();
		revokeMutateAsync.mockReset();
		vi.mocked(toast.success).mockReset();
		vi.mocked(toast.error).mockReset();
	});

	it("renders key status and opens the create-key dialog", async () => {
		const user = userEvent.setup();
		render(<ApiKeysPanel workspace="00000000-0000-4000-8000-000000000001" />);

		expect(screen.getByText("wb_live_abcdefghijkl_…")).toBeInTheDocument();
		expect(screen.getByText("Active")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "New key" }));
		expect(screen.getByRole("dialog")).toHaveTextContent("Create key dialog");
	});

	it("renders the scope tier as a friendly role label, not the raw array", () => {
		rows = [key({ scopes: ["read", "write"] })];
		const { unmount } = render(
			<ApiKeysPanel workspace="00000000-0000-4000-8000-000000000001" />,
		);
		// Same role label the create-dialog picker uses — keeps the
		// minting flow and the listing visually consistent.
		expect(screen.getByText("Editor")).toBeInTheDocument();
		// And the raw scope-array tokens are NOT rendered for the
		// role case (the badge collapses to a single chip).
		expect(screen.queryByText("read")).not.toBeInTheDocument();
		expect(screen.queryByText("write")).not.toBeInTheDocument();
		unmount();

		rows = [key({ scopes: ["read"] })];
		const viewer = render(
			<ApiKeysPanel workspace="00000000-0000-4000-8000-000000000001" />,
		);
		expect(screen.getByText("Viewer")).toBeInTheDocument();
		viewer.unmount();

		// `manage` is the admin tier — collapses to the loud "Admin" badge.
		rows = [key({ scopes: ["read", "write", "manage"] })];
		render(<ApiKeysPanel workspace="00000000-0000-4000-8000-000000000001" />);
		expect(screen.getByText("Admin")).toBeInTheDocument();
		expect(screen.queryByText("manage")).not.toBeInTheDocument();
	});

	it("renders fine-grained scopes as per-scope chips, not a role label", () => {
		rows = [key({ scopes: ["read:content", "write:ingest"] })];
		render(<ApiKeysPanel workspace="00000000-0000-4000-8000-000000000001" />);
		// A fine-scoped set isn't a whole coarse tier, so it falls through to
		// chips — each literal scope is shown verbatim.
		expect(screen.getByText("read:content")).toBeInTheDocument();
		expect(screen.getByText("write:ingest")).toBeInTheDocument();
		// ...and it does NOT collapse to a role badge.
		expect(screen.queryByText("Editor")).not.toBeInTheDocument();
		expect(screen.queryByText("Viewer")).not.toBeInTheDocument();
		expect(screen.queryByText("Admin")).not.toBeInTheDocument();
	});

	it("revokes an active key from the confirmation dialog", async () => {
		revokeMutateAsync.mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(<ApiKeysPanel workspace="00000000-0000-4000-8000-000000000001" />);

		await user.click(screen.getByRole("button", { name: "Revoke ci" }));
		expect(screen.getByRole("dialog")).toHaveTextContent("Revoke API key");
		await user.click(screen.getByRole("button", { name: "Revoke key" }));

		await waitFor(() =>
			expect(revokeMutateAsync).toHaveBeenCalledWith(
				"00000000-0000-4000-8000-000000000002",
			),
		);
		expect(toast.success).toHaveBeenCalledWith("Key 'ci' revoked");
	});
});
