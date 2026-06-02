import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useRlac", () => ({
	usePrincipals: vi.fn(() => ({
		data: [
			{ principalId: "alice", label: "Alice" },
			{ principalId: "bob", label: null },
		],
	})),
}));

import { setAuthToken } from "@/lib/authToken";
import { getViewAs, setViewAs } from "@/lib/viewAs";
import { ViewAsControl } from "./ViewAsControl";

const WS = "00000000-0000-4000-8000-000000000001";

function makeWrapper(qc: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
	};
}

function freshClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("ViewAsControl", () => {
	beforeEach(() => {
		window.localStorage.clear();
		setAuthToken(null);
	});
	afterEach(() => {
		window.localStorage.clear();
		setAuthToken(null);
	});

	it("renders nothing when RLAC is disabled", () => {
		const { container } = render(
			<ViewAsControl workspaceId={WS} rlacEnabled={false} />,
			{ wrapper: makeWrapper(freshClient()) },
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing when a bearer token is present (token derives the principal)", () => {
		setAuthToken("wb_live_test_token");
		const { container } = render(
			<ViewAsControl workspaceId={WS} rlacEnabled={true} />,
			{ wrapper: makeWrapper(freshClient()) },
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("shows a quiet admin-default control when RLAC is on and there is no token", () => {
		render(<ViewAsControl workspaceId={WS} rlacEnabled={true} />, {
			wrapper: makeWrapper(freshClient()),
		});
		const trigger = screen.getByRole("combobox", { name: /viewing as admin/i });
		expect(trigger).toBeInTheDocument();
		// Not impersonating → no principal name chip rendered.
		expect(trigger).not.toHaveTextContent("alice");
	});

	it("shows an amber chip naming the principal when impersonating", () => {
		setViewAs(WS, "alice");
		render(<ViewAsControl workspaceId={WS} rlacEnabled={true} />, {
			wrapper: makeWrapper(freshClient()),
		});
		const trigger = screen.getByRole("combobox", {
			name: /viewing as principal "alice"/i,
		});
		expect(trigger).toHaveTextContent("alice");
	});

	it("stores the selection and invalidates workspace queries when a principal is picked", async () => {
		const qc = freshClient();
		const invalidate = vi.spyOn(qc, "invalidateQueries");
		const user = userEvent.setup();
		render(<ViewAsControl workspaceId={WS} rlacEnabled={true} />, {
			wrapper: makeWrapper(qc),
		});

		await user.click(
			screen.getByRole("combobox", { name: /viewing as admin/i }),
		);
		await user.click(await screen.findByRole("option", { name: /Alice/ }));

		expect(getViewAs(WS)).toBe("alice");
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["workspaces", WS],
		});
	});

	it("returns to the default when admin is re-selected", async () => {
		setViewAs(WS, "alice");
		const user = userEvent.setup();
		render(<ViewAsControl workspaceId={WS} rlacEnabled={true} />, {
			wrapper: makeWrapper(freshClient()),
		});

		await user.click(
			screen.getByRole("combobox", { name: /viewing as principal "alice"/i }),
		);
		await user.click(await screen.findByRole("option", { name: /default/i }));

		expect(getViewAs(WS)).toBeNull();
	});
});
