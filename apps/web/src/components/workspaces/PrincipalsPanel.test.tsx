import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
	api: {
		listPrincipals: vi.fn(),
		createPrincipal: vi.fn(),
		deletePrincipal: vi.fn(),
	},
	formatApiError: (e: unknown) => (e instanceof Error ? e.message : "err"),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { api } from "@/lib/api";
import type { Principal } from "@/lib/schemas";
import { PrincipalsPanel } from "./PrincipalsPanel";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const WS = "00000000-0000-4000-8000-000000000001";

function principal(overrides: Partial<Principal>): Principal {
	return {
		workspaceId: WS,
		principalId: "alice",
		label: "Alice",
		attributes: {},
		role: "viewer",
		createdAt: "2026-06-01T00:00:00.000Z",
		updatedAt: "2026-06-01T00:00:00.000Z",
		...overrides,
	};
}

describe("PrincipalsPanel", () => {
	it("shows the empty state when there are no principals", async () => {
		vi.mocked(api.listPrincipals).mockResolvedValue([]);
		render(<PrincipalsPanel workspace={WS} />, { wrapper });
		expect(await screen.findByText("No principals yet")).toBeInTheDocument();
	});

	it("lists principals with their role and attributes", async () => {
		vi.mocked(api.listPrincipals).mockResolvedValue([
			principal({ principalId: "alice", role: "viewer" }),
			principal({
				principalId: "ops",
				label: null,
				role: "admin",
				attributes: { admin: "true" },
			}),
		]);
		render(<PrincipalsPanel workspace={WS} />, { wrapper });
		expect(await screen.findByText("alice")).toBeInTheDocument();
		expect(screen.getByText("ops")).toBeInTheDocument();
		expect(screen.getByText("admin=true")).toBeInTheDocument();
	});

	it("creates a principal through the add dialog", async () => {
		vi.mocked(api.listPrincipals).mockResolvedValue([]);
		vi.mocked(api.createPrincipal).mockResolvedValue(
			principal({ principalId: "bob" }),
		);
		render(<PrincipalsPanel workspace={WS} />, { wrapper });
		await screen.findByText("No principals yet");

		await userEvent.click(
			screen.getByRole("button", { name: /add principal/i }),
		);
		await userEvent.type(screen.getByLabelText("Principal id"), "bob");
		await userEvent.click(screen.getByRole("checkbox")); // admin bypass
		await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

		await waitFor(() =>
			expect(api.createPrincipal).toHaveBeenCalledWith(
				WS,
				expect.objectContaining({
					principalId: "bob",
					attributes: { admin: "true" },
				}),
			),
		);
	});
});
