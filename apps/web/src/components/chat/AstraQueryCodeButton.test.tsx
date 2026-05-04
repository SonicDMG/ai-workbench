/**
 * Behaviour tests for the Astra-query "view code" affordance:
 *   - renders nothing when there's no astra_queries metadata
 *   - renders nothing when astra_queries is malformed JSON / non-array
 *   - renders the code-icon trigger when at least one query is present
 *   - opens a dialog with the four language tabs
 *   - never includes a real Astra token literal in the rendered code
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/schemas";
import { AstraQueryCodeButton } from "./AstraQueryCodeButton";

const baseMessage: ChatMessage = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	chatId: "00000000-0000-4000-8000-000000000002",
	messageId: "00000000-0000-4000-8000-000000000003",
	messageTs: "2026-05-04T17:00:00.000Z",
	role: "agent",
	content: "Here's your answer.",
	tokenCount: 100,
	metadata: {},
};

const oneQueryJson = JSON.stringify([
	{
		knowledgeBaseId: "kb-1",
		kbName: "Engineering Docs",
		collection: "wb_vectors_kb_eng",
		keyspace: "default_keyspace",
		query: { text: "what is RAG", topK: 5 },
	},
]);

describe("AstraQueryCodeButton", () => {
	it("renders nothing when astra_queries is absent", () => {
		const { container } = render(
			<AstraQueryCodeButton message={baseMessage} />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders nothing when astra_queries is malformed JSON", () => {
		const { container } = render(
			<AstraQueryCodeButton
				message={{
					...baseMessage,
					metadata: { astra_queries: "{ not valid" },
				}}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders the code icon trigger when at least one query is present", () => {
		render(
			<AstraQueryCodeButton
				message={{
					...baseMessage,
					metadata: { astra_queries: oneQueryJson },
				}}
			/>,
		);
		expect(screen.getByTestId("astra-query-code-button")).toBeInTheDocument();
	});

	it("opens a dialog with the four language tabs on click", async () => {
		const user = userEvent.setup();
		render(
			<AstraQueryCodeButton
				message={{
					...baseMessage,
					metadata: { astra_queries: oneQueryJson },
				}}
			/>,
		);
		await user.click(screen.getByTestId("astra-query-code-button"));
		const tabs = await screen.findAllByTestId("astra-query-code-lang-tab");
		expect(tabs).toHaveLength(4);
		expect(tabs.map((t) => t.textContent)).toEqual([
			"TypeScript",
			"Python",
			"Java",
			"cURL",
		]);
	});

	it("does not include any AstraCS token literal in the rendered code", async () => {
		const user = userEvent.setup();
		render(
			<AstraQueryCodeButton
				message={{
					...baseMessage,
					metadata: { astra_queries: oneQueryJson },
				}}
			/>,
		);
		await user.click(screen.getByTestId("astra-query-code-button"));
		const block = await screen.findByTestId("astra-query-code-block");
		expect(block.textContent ?? "").not.toContain("AstraCS:");
	});

	it("syntax-highlights the rendered code via hljs token spans", async () => {
		const user = userEvent.setup();
		render(
			<AstraQueryCodeButton
				message={{
					...baseMessage,
					metadata: { astra_queries: oneQueryJson },
				}}
			/>,
		);
		await user.click(screen.getByTestId("astra-query-code-button"));
		const block = await screen.findByTestId("astra-query-code-block");
		const innerCode = block.querySelector("code");
		expect(innerCode).not.toBeNull();
		// The hljs root class anchors the theme; per-token spans
		// (`hljs-keyword`, `hljs-string`, etc.) prove the highlighter
		// actually ran and the rendered tree carries lowlight's token
		// metadata rather than just plain text.
		expect(innerCode?.className).toMatch(/\bhljs\b/);
		expect(innerCode?.querySelector("span[class*='hljs-']")).not.toBeNull();
		// Tokenization preserves the literal source verbatim — round-
		// trip through the renderer.
		expect(innerCode?.textContent).toContain("DataAPIClient");
	});
});
