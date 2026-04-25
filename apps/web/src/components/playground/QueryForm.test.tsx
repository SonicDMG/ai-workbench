import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VectorStoreRecord } from "@/lib/schemas";
import { QueryForm } from "./QueryForm";

function makeStore(
	overrides: Partial<VectorStoreRecord> = {},
): VectorStoreRecord {
	return {
		workspace: "00000000-0000-4000-8000-000000000001",
		uid: "00000000-0000-4000-8000-0000000000aa",
		name: "vs",
		vectorDimension: 4,
		vectorSimilarity: "cosine",
		embedding: {
			provider: "mock",
			model: "mock-embedder",
			endpoint: null,
			dimension: 4,
			secretRef: null,
		},
		lexical: { enabled: false, analyzer: null, options: {} },
		reranking: {
			enabled: false,
			provider: null,
			model: null,
			endpoint: null,
			secretRef: null,
		},
		createdAt: "2026-04-22T10:11:12.345Z",
		updatedAt: "2026-04-22T10:11:12.345Z",
		...overrides,
	};
}

describe("QueryForm", () => {
	it("submits a text query with a parsed filter", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		render(
			<QueryForm vectorStore={makeStore()} onRun={onRun} pending={false} />,
		);

		await user.type(screen.getByLabelText(/Query/), "blue sweater");
		// userEvent.type treats `{` / `[` as keyboard descriptors; for
		// JSON-shaped values we drive the textarea via fireEvent.change.
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
		render(
			<QueryForm vectorStore={makeStore()} onRun={onRun} pending={false} />,
		);

		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).not.toHaveBeenCalled();
		expect(screen.getByText(/text is required/i)).toBeInTheDocument();
	});

	it("opts hybrid into the request when the toggle is on", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		render(
			<QueryForm
				vectorStore={makeStore({
					lexical: { enabled: true, analyzer: null, options: {} },
				})}
				onRun={onRun}
				pending={false}
			/>,
		);

		await user.type(screen.getByLabelText(/Query/), "anything");
		await user.click(screen.getByRole("checkbox", { name: /Hybrid/ }));
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).toHaveBeenCalledWith(
			expect.objectContaining({ text: "anything", hybrid: true }),
		);
	});

	it("blocks hybrid/rerank on the Vector tab with a clear message", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		render(
			<QueryForm
				vectorStore={makeStore({
					lexical: { enabled: true, analyzer: null, options: {} },
				})}
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
