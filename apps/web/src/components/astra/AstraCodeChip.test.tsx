/**
 * Behaviour tests for the generic AstraCodeChip — the props-driven
 * surface the chat wrapper, KB-create dialog, ingest queue, and
 * delete confirmation all mount.
 *
 * The chat-message back-compat parser is already covered by the
 * AstraQueryCodeButton tests; this file focuses on the new surface
 * area the chip introduces:
 *   - empty `snapshots` → returns null (no chip rendered)
 *   - preview variant changes trigger label/title + dialog header
 *   - multi-snapshot tab pills render distinct labels per `kind`
 *   - footer caveat renders inside the dialog when provided
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AstraQuerySnapshot } from "@/lib/schemas";
import { AstraCodeChip } from "./AstraCodeChip";

const vectorSearchSnapshot: AstraQuerySnapshot = {
	kind: "vector_search",
	knowledgeBaseId: "kb-1",
	kbName: "Engineering Docs",
	collection: "wb_vectors_kb_eng",
	keyspace: "default_keyspace",
	query: { text: "what is RAG?", topK: 5 },
};

const createCollectionSnapshot: AstraQuerySnapshot = {
	kind: "create_collection",
	knowledgeBaseId: "kb-1",
	kbName: "Engineering Docs",
	collection: "wb_vectors_kb_eng",
	keyspace: "default_keyspace",
	options: {
		vectorDimension: 1536,
		vectorMetric: "cosine",
		vectorize: { provider: "openai", modelName: "text-embedding-3-small" },
		lexical: null,
		rerank: null,
	},
};

describe("AstraCodeChip", () => {
	it("renders nothing when snapshots is empty", () => {
		const { container } = render(<AstraCodeChip snapshots={[]} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders the actual-variant trigger by default", () => {
		render(<AstraCodeChip snapshots={[vectorSearchSnapshot]} />);
		const trigger = screen.getByTestId("astra-code-chip");
		expect(trigger).toBeInTheDocument();
		expect(trigger.textContent).toContain("code");
	});

	it("renders the preview-variant trigger when variant=preview", () => {
		render(
			<AstraCodeChip
				snapshots={[createCollectionSnapshot]}
				variant="preview"
			/>,
		);
		const trigger = screen.getByTestId("astra-code-chip");
		expect(trigger.textContent).toContain("preview");
		// Title surfaces the "will make" tense so users know the call
		// hasn't happened yet.
		expect(trigger.getAttribute("title") ?? "").toContain("will make");
	});

	it("dialog header reads 'preview' when variant=preview", async () => {
		const user = userEvent.setup();
		render(
			<AstraCodeChip
				snapshots={[createCollectionSnapshot]}
				variant="preview"
			/>,
		);
		await user.click(screen.getByTestId("astra-code-chip"));
		expect(
			await screen.findByText(/Astra Data API call \(preview\)/),
		).toBeInTheDocument();
	});

	it("renders a footer caveat inside the dialog when provided", async () => {
		const user = userEvent.setup();
		render(
			<AstraCodeChip
				snapshots={[vectorSearchSnapshot]}
				footer="Repeated for each batch of 50 chunks."
			/>,
		);
		await user.click(screen.getByTestId("astra-code-chip"));
		expect(
			await screen.findByText("Repeated for each batch of 50 chunks."),
		).toBeInTheDocument();
	});

	it("renders per-kind labels on multi-snapshot tabs", async () => {
		const user = userEvent.setup();
		render(
			<AstraCodeChip
				snapshots={[createCollectionSnapshot, vectorSearchSnapshot]}
			/>,
		);
		await user.click(screen.getByTestId("astra-code-chip"));
		const tabs = await screen.findAllByTestId("astra-code-chip-snapshot-tab");
		expect(tabs).toHaveLength(2);
		// `vector_search` shows the bare KB name; `create_collection`
		// suffixes a kind hint so the two stay distinguishable when
		// they target the same KB.
		const labels = tabs.map((t) => t.textContent ?? "");
		expect(labels).toContain("Engineering Docs");
		expect(labels).toContain("Engineering Docs · create");
	});

	it("language tabs render in TS/Python/Java/cURL order", async () => {
		const user = userEvent.setup();
		render(<AstraCodeChip snapshots={[vectorSearchSnapshot]} />);
		await user.click(screen.getByTestId("astra-code-chip"));
		const tabs = await screen.findAllByTestId("astra-code-chip-lang-tab");
		expect(tabs.map((t) => t.textContent)).toEqual([
			"TypeScript",
			"Python",
			"Java",
			"cURL",
		]);
	});
});
