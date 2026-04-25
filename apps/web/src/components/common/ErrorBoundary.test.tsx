import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

// React logs caught errors via console.error before our boundary
// renders the fallback. Silence to keep test output clean while
// still asserting the boundary is doing its job.
beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

function Boom({ explode }: { explode: boolean }) {
	if (explode) throw new Error("kaboom");
	return <div>fine</div>;
}

describe("ErrorBoundary", () => {
	it("renders children when nothing throws", () => {
		render(
			<ErrorBoundary>
				<Boom explode={false} />
			</ErrorBoundary>,
		);
		expect(screen.getByText("fine")).toBeInTheDocument();
	});

	it("renders the fallback when a child throws on render", () => {
		render(
			<ErrorBoundary>
				<Boom explode={true} />
			</ErrorBoundary>,
		);
		expect(screen.getByText("Something went wrong")).toBeInTheDocument();
		expect(screen.getByText("kaboom")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Try again" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Reload page" }),
		).toBeInTheDocument();
	});

	it("'Try again' clears the error and re-renders children", async () => {
		const user = userEvent.setup();
		function Harness() {
			const [explode, setExplode] = useState(true);
			// Wire the click to flip the error condition before retry.
			return (
				<>
					<button type="button" onClick={() => setExplode(false)}>
						defuse
					</button>
					<ErrorBoundary>
						<Boom explode={explode} />
					</ErrorBoundary>
				</>
			);
		}
		render(<Harness />);
		expect(screen.getByText("Something went wrong")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "defuse" }));
		await user.click(screen.getByRole("button", { name: "Try again" }));

		expect(screen.getByText("fine")).toBeInTheDocument();
	});

	it("resets when resetKey changes (e.g. on route change)", () => {
		const { rerender } = render(
			<ErrorBoundary resetKey="/a">
				<Boom explode={true} />
			</ErrorBoundary>,
		);
		expect(screen.getByText("Something went wrong")).toBeInTheDocument();

		rerender(
			<ErrorBoundary resetKey="/b">
				<Boom explode={false} />
			</ErrorBoundary>,
		);
		expect(screen.getByText("fine")).toBeInTheDocument();
	});
});
