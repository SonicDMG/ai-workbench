/**
 * Render tests for the top-level Settings page.
 *
 * The page hosts the runtime credentials editor: paste-and-update
 * for `ASTRA_DB_API_ENDPOINT`, `ASTRA_DB_APPLICATION_TOKEN`, and
 * `HUGGINGFACE_API_KEY` against `/setup/env` + `/setup/restart`.
 * Same call pattern as the first-run onboarding wizard, but
 * reachable post-setup so operators can fix a missing
 * HUGGINGFACE_API_KEY without going to the shell.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupStatus } from "@/lib/schemas";

vi.mock("@/lib/api", () => ({
	api: {
		getSetupStatus: vi.fn(),
		postSetupEnv: vi.fn(),
		postSetupRestart: vi.fn(),
	},
	formatApiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
	ApiError: class ApiError extends Error {},
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { api } from "@/lib/api";
import { SettingsPage } from "./SettingsPage";

const status: SetupStatus = {
	setupComplete: true,
	workspacesCount: 1,
	controlPlane: { kind: "memory", healthy: true },
	hasChatProvider: false,
	hasAstraCreds: true,
	managedEnv: {
		path: "/tmp/wb/.env",
		writable: true,
		present: true,
	},
};

function wrap(children: ReactNode) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return (
		<QueryClientProvider client={qc}>
			<MemoryRouter>{children}</MemoryRouter>
		</QueryClientProvider>
	);
}

describe("SettingsPage", () => {
	beforeEach(() => {
		vi.mocked(api.getSetupStatus).mockResolvedValue(status);
		// Stub `fetch` so the /readyz poll the restart flow uses returns OK.
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(new Response("{}", { status: 200 }));
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("renders three credential inputs with the documented placeholder copy", async () => {
		render(wrap(<SettingsPage />));
		await waitFor(() => {
			expect(
				screen.getByLabelText(/Astra DB API endpoint/i),
			).toBeInTheDocument();
			expect(
				screen.getByLabelText(/Astra DB application token/i),
			).toBeInTheDocument();
			expect(screen.getByLabelText(/HuggingFace API key/i)).toBeInTheDocument();
		});
	});

	it("surfaces the runtime's chat-not-configured state in the page banner", async () => {
		render(wrap(<SettingsPage />));
		await waitFor(() =>
			expect(screen.getByText(/Chat is unconfigured/i)).toBeInTheDocument(),
		);
	});

	it("only sends non-empty fields to /setup/env", async () => {
		vi.mocked(api.postSetupEnv).mockResolvedValue({
			ok: true,
			managedEnv: status.managedEnv,
			written: ["HUGGINGFACE_API_KEY"],
			restartRequired: true,
		});
		vi.mocked(api.postSetupRestart).mockResolvedValue(undefined);

		render(wrap(<SettingsPage />));
		const user = userEvent.setup();
		const hfInput = await screen.findByLabelText(/HuggingFace API key/i);
		await user.type(hfInput, "hf_NEWtoken");

		await act(async () => {
			await user.click(
				screen.getByRole("button", { name: /Save .* restart/i }),
			);
		});

		await waitFor(() =>
			expect(api.postSetupEnv).toHaveBeenCalledWith({
				HUGGINGFACE_API_KEY: "hf_NEWtoken",
			}),
		);
	});

	it("blocks save when every field is empty (no /setup/env call)", async () => {
		render(wrap(<SettingsPage />));
		const user = userEvent.setup();
		const button = await screen.findByRole("button", {
			name: /Save .* restart/i,
		});
		// The button should reject the empty submit either by being
		// disabled or by short-circuiting; we just need the API not
		// to fire.
		await act(async () => {
			await user.click(button);
		});
		expect(api.postSetupEnv).not.toHaveBeenCalled();
	});

	it("warns when the managed env file is not writable", async () => {
		vi.mocked(api.getSetupStatus).mockResolvedValue({
			...status,
			managedEnv: { ...status.managedEnv, writable: false },
		});
		render(wrap(<SettingsPage />));
		await waitFor(() =>
			expect(
				screen.getByText(/Managed env file is not writable/i),
			).toBeInTheDocument(),
		);
	});

	it("renders the rescue-mode banner when /setup-status carries a bootError", async () => {
		vi.mocked(api.getSetupStatus).mockResolvedValue({
			...status,
			setupComplete: false,
			workspacesCount: 0,
			controlPlane: { kind: "unavailable", healthy: false },
			bootError: {
				code: "control_plane_dns_unresolvable",
				message:
					"getaddrinfo ENOTFOUND fake-db-id-us-east-2.apps.astra.datastax.com",
			},
		});
		render(wrap(<SettingsPage />));
		await waitFor(() =>
			expect(screen.getByRole("alert")).toHaveTextContent(
				/Runtime is in rescue mode/i,
			),
		);
		expect(
			screen.getByText(/control_plane_dns_unresolvable/),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Astra endpoint hostname didn't resolve/i),
		).toBeInTheDocument();
		// The chat-unconfigured banner shouldn't also render — the
		// rescue banner supersedes it.
		expect(screen.queryByText(/Chat is unconfigured/i)).toBeNull();
	});
});
