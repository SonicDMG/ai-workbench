/**
 * Coverage for {@link MarkdownContent} — markdown rendering of
 * Bobbie's assistant content plus `[chunkId]` citation linkback
 * rewriting against the chunk map persisted in
 * `metadata.context_chunks`.
 */

import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import {
	type ChunkRef,
	injectCitations,
	MarkdownContent,
	parseChunkMap,
} from "./MarkdownContent";

function renderInRouter(node: React.ReactNode) {
	return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("injectCitations", () => {
	const ws = "11111111-1111-4111-8111-111111111111";
	const chunkMap = new Map<string, ChunkRef>([
		[
			"chunk-1",
			{
				chunkId: "chunk-1",
				knowledgeBaseId: "kb-A",
				documentId: "doc-X",
			},
		],
		[
			"chunk-no-doc",
			{
				chunkId: "chunk-no-doc",
				knowledgeBaseId: "kb-B",
				documentId: null,
			},
		],
	]);

	test("rewrites bare [chunkId] to a markdown link with deep-link query", () => {
		const out = injectCitations("As cited in [chunk-1].", chunkMap, ws);
		expect(out).toContain(
			`[chunk-1](/workspaces/${ws}/knowledge-bases/kb-A?document=doc-X&chunk=chunk-1)`,
		);
	});

	test("links chunks without a document to the KB with `?chunk=…` only", () => {
		const out = injectCitations("See [chunk-no-doc].", chunkMap, ws);
		expect(out).toBe(
			`See [chunk-no-doc](/workspaces/${ws}/knowledge-bases/kb-B?chunk=chunk-no-doc).`,
		);
	});

	test("leaves unknown chunk IDs untouched", () => {
		const out = injectCitations("A [chunk-unknown] reference.", chunkMap, ws);
		expect(out).toBe("A [chunk-unknown] reference.");
	});

	test("does not double-rewrite an already-linked citation", () => {
		const already = "Cited [chunk-1](https://example.com/x).";
		expect(injectCitations(already, chunkMap, ws)).toBe(already);
	});

	test("returns input verbatim when chunk map is empty", () => {
		const empty = new Map<string, ChunkRef>();
		expect(injectCitations("A [chunk-1] line.", empty, ws)).toBe(
			"A [chunk-1] line.",
		);
	});
});

describe("parseChunkMap", () => {
	test("parses a context_chunks tuple-array into a map", () => {
		const md = parseChunkMap({
			context_chunks: JSON.stringify([
				["c1", "kb-A", "doc-1"],
				["c2", "kb-B", null],
			]),
		});
		expect(md.size).toBe(2);
		expect(md.get("c1")).toEqual({
			chunkId: "c1",
			knowledgeBaseId: "kb-A",
			documentId: "doc-1",
		});
		expect(md.get("c2")?.documentId).toBeNull();
	});

	test("falls back to context_document_ids when context_chunks is absent", () => {
		const md = parseChunkMap({ context_document_ids: "c1,c2,c3" });
		expect(md.size).toBe(3);
		expect(md.get("c1")).toEqual({
			chunkId: "c1",
			knowledgeBaseId: "",
			documentId: null,
		});
	});

	test("returns empty map for missing / empty metadata", () => {
		expect(parseChunkMap({}).size).toBe(0);
		expect(parseChunkMap({ context_chunks: "" }).size).toBe(0);
	});

	test("tolerates malformed JSON without throwing", () => {
		const md = parseChunkMap({ context_chunks: "{not valid json" });
		expect(md.size).toBe(0);
	});

	test("skips malformed tuple rows", () => {
		const md = parseChunkMap({
			context_chunks: JSON.stringify([
				["c1", "kb-A", "doc-1"],
				"not an array",
				[123, "kb", "doc"], // wrong types
				["c2", "kb-B"], // 2-tuple is fine — docId becomes null
			]),
		});
		expect(md.size).toBe(2);
		expect(md.has("c1")).toBe(true);
		expect(md.get("c2")?.documentId).toBeNull();
	});
});

describe("<MarkdownContent />", () => {
	const ws = "11111111-1111-4111-8111-111111111111";

	test("renders bold + lists from markdown source", () => {
		renderInRouter(
			<MarkdownContent
				content={"**Important**\n\n- one\n- two"}
				workspaceId={ws}
			/>,
		);
		expect(screen.getByText("Important").tagName).toBe("STRONG");
		const listItems = screen.getAllByRole("listitem");
		expect(listItems.map((li) => li.textContent)).toEqual(["one", "two"]);
	});

	test("renders fenced code blocks", () => {
		renderInRouter(
			<MarkdownContent content={"```ts\nconst x = 1;\n```"} workspaceId={ws} />,
		);
		// Both inline and block code use <code>; the block has a
		// language- class, which is what our custom renderer keys on.
		const code = screen.getByText("const x = 1;");
		expect(code.tagName).toBe("CODE");
	});

	test("renders [chunkId] as a react-router citation link", () => {
		const chunkMap = new Map<string, ChunkRef>([
			[
				"chunk-1",
				{
					chunkId: "chunk-1",
					knowledgeBaseId: "kb-A",
					documentId: "doc-X",
				},
			],
		]);
		renderInRouter(
			<MarkdownContent
				content={"As cited in [chunk-1]."}
				workspaceId={ws}
				chunkMap={chunkMap}
			/>,
		);
		const link = screen.getByTestId("chat-citation-link");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe(
			`/workspaces/${ws}/knowledge-bases/kb-A?document=doc-X&chunk=chunk-1`,
		);
		expect(link.textContent).toBe("chunk-1");
	});

	test("strips raw HTML via rehype-sanitize", () => {
		renderInRouter(
			<MarkdownContent
				content={"hello <script>alert('xss')</script> world"}
				workspaceId={ws}
			/>,
		);
		// The script tag must not survive. (It's also not executable in
		// jsdom anyway, but the *element* should be gone.)
		const root = screen.getByText(/hello/);
		expect(
			within(root.closest(".markdown-content") as HTMLElement).queryByText(
				"alert",
			),
		).toBeNull();
		expect(document.querySelector("script")).toBeNull();
	});

	test("renders external links with target=_blank", () => {
		renderInRouter(
			<MarkdownContent
				content={"See [docs](https://example.com)."}
				workspaceId={ws}
			/>,
		);
		const link = screen.getByRole("link", { name: "docs" });
		expect(link.getAttribute("href")).toBe("https://example.com");
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toContain("noreferrer");
	});
});
