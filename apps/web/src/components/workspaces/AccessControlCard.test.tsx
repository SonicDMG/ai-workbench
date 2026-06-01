import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
	api: { updateWorkspace: vi.fn() },
	formatApiError: (e: unknown) => (e instanceof Error ? e.message : "err"),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { api } from "@/lib/api";
import type { Workspace } from "@/lib/schemas";
import { AccessControlCard } from "./AccessControlCard";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const WS: Workspace = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	name: "w",
	kind: "mock",
	url: null,
	keyspace: null,
	credentials: {},
	rlacEnabled: false,
	createdAt: "2026-06-01T00:00:00.000Z",
	updatedAt: "2026-06-01T00:00:00.000Z",
};

describe("AccessControlCard", () => {
	it("enables RLAC when toggled on from the disabled state", async () => {
		vi.mocked(api.updateWorkspace).mockResolvedValue({
			...WS,
			rlacEnabled: true,
		});
		render(<AccessControlCard workspace={WS} />, { wrapper });
		expect(screen.getByText("Disabled")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: /enable rlac/i }));
		await waitFor(() =>
			expect(api.updateWorkspace).toHaveBeenCalledWith(WS.workspaceId, {
				rlacEnabled: true,
			}),
		);
	});

	it("disables RLAC when toggled off from the enabled state", async () => {
		vi.mocked(api.updateWorkspace).mockResolvedValue({
			...WS,
			rlacEnabled: false,
		});
		render(<AccessControlCard workspace={{ ...WS, rlacEnabled: true }} />, {
			wrapper,
		});
		expect(screen.getByText("Enabled")).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: /disable rlac/i }),
		);
		await waitFor(() =>
			expect(api.updateWorkspace).toHaveBeenCalledWith(WS.workspaceId, {
				rlacEnabled: false,
			}),
		);
	});
});
