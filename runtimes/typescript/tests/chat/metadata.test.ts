/**
 * Unit coverage for `buildAgentMetadata` — the composer that produces
 * the assistant message's `metadata` map at chat write time. The web
 * UI relies on `context_chunks` being a JSON-encoded tuple array so
 * it can render `[chunkId]` citation linkbacks without a follow-up
 * fetch; this test pins that wire shape.
 */

import { describe, expect, test } from "vitest";
import { buildAgentMetadata } from "../../src/chat/agent-dispatch.js";

const okStop = { finishReason: "stop" as const, errorMessage: null };

describe("agent-dispatch.buildAgentMetadata", () => {
	test("with no chunks: writes only model + finish_reason", () => {
		const md = buildAgentMetadata([], "fake-model", okStop);
		expect(md).toEqual({ model: "fake-model", finish_reason: "stop" });
		expect(md.context_chunks).toBeUndefined();
		expect(md.context_document_ids).toBeUndefined();
	});

	test("with chunks: writes both context_document_ids and context_chunks", () => {
		const chunks = [
			{ chunkId: "chunk-1", knowledgeBaseId: "kb-a", documentId: "doc-1" },
			{ chunkId: "chunk-2", knowledgeBaseId: "kb-a", documentId: "doc-2" },
			{ chunkId: "chunk-3", knowledgeBaseId: "kb-b", documentId: null },
		];
		const md = buildAgentMetadata(chunks, "fake-model", okStop);
		// Backward-compat key — comma-joined chunk IDs.
		expect(md.context_document_ids).toBe("chunk-1,chunk-2,chunk-3");
		// New key — compact JSON array of [chunkId, kbId, documentId].
		expect(md.context_chunks).toBeDefined();
		const parsed = JSON.parse(md.context_chunks ?? "[]");
		expect(parsed).toEqual([
			["chunk-1", "kb-a", "doc-1"],
			["chunk-2", "kb-a", "doc-2"],
			["chunk-3", "kb-b", null],
		]);
	});

	test("with error: writes finish_reason=error + error_message", () => {
		const md = buildAgentMetadata([], "fake-model", {
			finishReason: "error",
			errorMessage: "rate limit",
		});
		expect(md.finish_reason).toBe("error");
		expect(md.error_message).toBe("rate limit");
	});

	test("preserves chunk order in context_chunks (matches sorted retrieval order)", () => {
		// `retrieveContext` sorts by score DESC and slices to a cap; the
		// metadata must preserve that order so the UI's "Sources" list
		// shows the highest-scored chunk first.
		const chunks = [
			{ chunkId: "c-third", knowledgeBaseId: "kb-a", documentId: null },
			{ chunkId: "c-first", knowledgeBaseId: "kb-a", documentId: null },
			{ chunkId: "c-second", knowledgeBaseId: "kb-a", documentId: null },
		];
		const md = buildAgentMetadata(chunks, "m", okStop);
		expect(md.context_document_ids).toBe("c-third,c-first,c-second");
		const parsed = JSON.parse(md.context_chunks ?? "[]") as unknown[][];
		expect(parsed.map((row) => row[0])).toEqual([
			"c-third",
			"c-first",
			"c-second",
		]);
	});
});
