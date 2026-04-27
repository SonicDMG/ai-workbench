import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryForm, type QueryFormTarget } from "./QueryForm";

function makeTarget(overrides: Partial<QueryFormTarget> = {}): QueryFormTarget {
	return {
		vectorDimension: 4,
		embeddingProvider: "mock:mock-embedder",
		lexicalSupported: false,
		rerankSupported: false,
		...overrides,
	};
}

describe("QueryForm", () => {
	it("submits a text query with a parsed filter", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		render(<QueryForm target={makeTarget()} onRun={onRun} pending={false} />);

		await user.type(screen.getByLabelText(/Query/), "blue sweater");
		fireEvent.change(screen.getByLabelText(/Filter/), {
			target: { value: '{"category": "apparel"}' },
		});
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).toHaveBeenCalledTimes(1);
		expect(onRun).toHaveBeenCalledWith({
			text: "blue sweater",
			topK: 10,
			filter: { category: "apparel" },
		});
	});

	it("rejects an empty text query inline without calling onRun", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		render(<QueryForm target={makeTarget()} onRun={onRun} pending={false} />);

		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).not.toHaveBeenCalled();
		expect(screen.getByText(/text is required/i)).toBeInTheDocument();
	});

	it("opts hybrid into the request with a default lexical weight when toggled on", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		render(
			<QueryForm
				target={makeTarget({ lexicalSupported: true })}
				onRun={onRun}
				pending={false}
			/>,
		);

		await user.type(screen.getByLabelText(/Query/), "anything");
		await user.click(screen.getByRole("checkbox", { name: /Hybrid/ }));
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "anything",
				hybrid: true,
				lexicalWeight: 0.5,
			}),
		);
	});

	it("hides the lexical-weight slider until hybrid is on", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		render(
			<QueryForm
				target={makeTarget({ lexicalSupported: true })}
				onRun={onRun}
				pending={false}
			/>,
		);

		expect(screen.queryByLabelText(/Lexical weight/i)).not.toBeInTheDocument();

		await user.click(screen.getByRole("checkbox", { name: /Hybrid/ }));

		expect(
			screen.getByLabelText(/Lexical weight \(0\.50\)/),
		).toBeInTheDocument();
	});

	it("forwards a custom lexical weight when the slider is dragged", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		render(
			<QueryForm
				target={makeTarget({ lexicalSupported: true })}
				onRun={onRun}
				pending={false}
			/>,
		);

		await user.type(screen.getByLabelText(/Query/), "find me");
		await user.click(screen.getByRole("checkbox", { name: /Hybrid/ }));
		fireEvent.change(screen.getByLabelText(/Lexical weight/), {
			target: { value: "0.8" },
		});
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).toHaveBeenCalledWith(
			expect.objectContaining({ hybrid: true, lexicalWeight: 0.8 }),
		);
	});

	it("omits lexicalWeight when hybrid is off", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		render(
			<QueryForm
				target={makeTarget({ lexicalSupported: true })}
				onRun={onRun}
				pending={false}
			/>,
		);

		await user.type(screen.getByLabelText(/Query/), "plain");
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		const call = onRun.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(call.lexicalWeight).toBeUndefined();
		expect(call.hybrid).toBeUndefined();
	});

	it("blocks hybrid/rerank on the Vector tab with a clear message", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		render(
			<QueryForm
				target={makeTarget({ lexicalSupported: true })}
				onRun={onRun}
				pending={false}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Vector" }));
		fireEvent.change(screen.getByLabelText(/Vector \(/), {
			target: { value: "[0.1, 0.2, 0.3, 0.4]" },
		});
		await user.click(screen.getByRole("checkbox", { name: /Hybrid/ }));
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).not.toHaveBeenCalled();
		expect(
			screen.getByText(/hybrid and rerank require a text query/i),
		).toBeInTheDocument();
	});
});
