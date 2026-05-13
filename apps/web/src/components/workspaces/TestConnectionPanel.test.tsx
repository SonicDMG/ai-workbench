import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
let probeState: {
	data: unknown;
	error: unknown;
	isPending: boolean;
} = { data: undefined, error: undefined, isPending: false };

vi.mock("@/hooks/useWorkspaces", () => ({
	useTestConnection: () => ({
		mutate,
		data: probeState.data,
		error: probeState.error,
		isPending: probeState.isPending,
	}),
}));

import { TestConnectionPanel } from "./TestConnectionPanel";

beforeEach(() => {
	mutate.mockReset();
	probeState = { data: undefined, error: undefined, isPending: false };
});

describe("TestConnectionPanel", () => {
	it("opens the dialog and triggers the probe mutation when Test Connectivity is clicked", async () => {
		const user = userEvent.setup();
		render(<TestConnectionPanel workspaceId="ws-1" />);
		await user.click(screen.getByRole("button", { name: "Test Connectivity" }));
		expect(mutate).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});

	it("renders a Testing… label and disables the button while the probe is pending", () => {
		probeState = { data: undefined, error: undefined, isPending: true };
		render(<TestConnectionPanel workspaceId="ws-1" />);
		const button = screen.getByRole("button", { name: "Testing…" });
		expect(button).toBeDisabled();
	});

	it("renders the success banner when the probe returns ok=true", async () => {
		const user = userEvent.setup();
		probeState = {
			data: {
				ok: true,
				details: "Reached https://example.apps.astra.datastax.com",
			},
			error: undefined,
			isPending: false,
		};
		render(<TestConnectionPanel workspaceId="ws-1" />);
		await user.click(screen.getByRole("button", { name: "Test Connectivity" }));
		expect(screen.getByText("Connection passed")).toBeInTheDocument();
		expect(screen.getByText(/Reached https:\/\/example/)).toBeInTheDocument();
	});

	it("renders the warning banner when the probe returns ok=false with details", async () => {
		const user = userEvent.setup();
		probeState = {
			data: { ok: false, details: "401 from Data API: bad token" },
			error: undefined,
			isPending: false,
		};
		render(<TestConnectionPanel workspaceId="ws-1" />);
		await user.click(screen.getByRole("button", { name: "Test Connectivity" }));
		expect(screen.getByText("Connection failed")).toBeInTheDocument();
		expect(
			screen.getByText("401 from Data API: bad token"),
		).toBeInTheDocument();
	});

	it("renders the runtime error banner when the mutation itself rejects", async () => {
		const user = userEvent.setup();
		probeState = {
			data: undefined,
			error: new Error("network error"),
			isPending: false,
		};
		render(<TestConnectionPanel workspaceId="ws-1" />);
		await user.click(screen.getByRole("button", { name: "Test Connectivity" }));
		expect(screen.getByText("Probe failed to run")).toBeInTheDocument();
	});
});
