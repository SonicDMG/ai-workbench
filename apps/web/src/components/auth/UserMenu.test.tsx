import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetchAuthConfig: vi.fn(),
	fetchSessionSubject: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
	fetchAuthConfig: mocks.fetchAuthConfig,
	fetchSessionSubject: mocks.fetchSessionSubject,
	loginHref: (path: string, redirectAfter: string) =>
		`${path}?redirect_after=${encodeURIComponent(redirectAfter)}`,
	logout: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
	},
}));

import { UserMenu } from "./UserMenu";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("UserMenu", () => {
	beforeEach(() => {
		mocks.fetchAuthConfig.mockReset();
		mocks.fetchSessionSubject.mockReset();
	});

	it("renders the signed-in OIDC subject and logout affordance", async () => {
		mocks.fetchAuthConfig.mockResolvedValue({
			modes: { apiKey: true, oidc: true, login: true },
			loginPath: "/auth/login",
			refreshPath: "/auth/refresh",
		});
		mocks.fetchSessionSubject.mockResolvedValue({
			id: "user-1",
			label: "ada@example.com",
			type: "oidc",
			workspaceScopes: [],
			expiresAt: 1777230000,
			canRefresh: true,
		});

		render(<UserMenu />, { wrapper });

		expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
	});

	it("renders login when browser OIDC is available but no session exists", async () => {
		mocks.fetchAuthConfig.mockResolvedValue({
			modes: { apiKey: true, oidc: true, login: true },
			loginPath: "/auth/login",
			refreshPath: "/auth/refresh",
		});
		mocks.fetchSessionSubject.mockResolvedValue(null);

		render(<UserMenu />, { wrapper });

		expect(
			await screen.findByRole("button", { name: /Log in/ }),
		).toBeInTheDocument();
	});
});
