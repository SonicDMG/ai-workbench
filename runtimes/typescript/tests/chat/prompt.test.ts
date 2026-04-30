import { describe, expect, test } from "vitest";
import { assemblePrompt, type RetrievedChunk } from "../../src/chat/prompt.js";
import type { MessageRecord } from "../../src/control-plane/types.js";

const SYSTEM = "You are a helpful assistant.";

function userMsg(
	content: string,
	ts = "2026-04-28T00:00:00.000Z",
): MessageRecord {
	return {
		workspaceId: "ws",
		conversationId: "chat",
		messageTs: ts,
		messageId: `m-${ts}`,
		role: "user",
		authorId: null,
		content,
		toolId: null,
		toolCallPayload: null,
		toolResponse: null,
		tokenCount: null,
		metadata: {},
	};
}

function agentMsg(
	content: string,
	ts = "2026-04-28T00:00:00.000Z",
	metadata: Record<string, string> = {},
): MessageRecord {
	return {
		workspaceId: "ws",
		conversationId: "chat",
		messageTs: ts,
		messageId: `m-${ts}`,
		role: "agent",
		authorId: "agent",
		content,
		toolId: null,
		toolCallPayload: null,
		toolResponse: null,
		tokenCount: null,
		metadata,
	};
}

describe("assemblePrompt", () => {
	test("emits system + user with no history when first turn", () => {
		const turns = assemblePrompt({
			systemPrompt: SYSTEM,
			chunks: [],
			history: [],
			userTurn: "hello",
		});
		expect(turns).toEqual([
			{ role: "system", content: SYSTEM },
			{ role: "user", content: "hello" },
		]);
	});

	test("includes retrieved chunks in the system turn with chunk-id citations", () => {
		const chunks: RetrievedChunk[] = [
			{
				chunkId: "chunk-1",
				knowledgeBaseId: "kb-a",
				documentId: "doc-1",
				content: "Astra is a managed cloud database.",
				score: 0.9,
			},
			{
				chunkId: "chunk-2",
				knowledgeBaseId: "kb-b",
				documentId: null,
				content: "Vector search is similarity-based.",
				score: 0.8,
			},
		];
		const turns = assemblePrompt({
			systemPrompt: SYSTEM,
			chunks,
			history: [],
			userTurn: "what is Astra?",
		});
		const system = turns[0];
		if (!system) throw new Error("missing system turn");
		expect(system.role).toBe("system");
		expect(system.content).toContain(SYSTEM);
		expect(system.content).toContain("[chunk-1]");
		expect(system.content).toContain("[chunk-2]");
		expect(system.content).toContain("kb=kb-a");
		expect(system.content).toContain("Astra is a managed cloud database");
	});

	test("maps history to user/assistant roles and skips empty/errored placeholders", () => {
		const history: MessageRecord[] = [
			userMsg("hi", "2026-04-28T00:00:00.000Z"),
			agentMsg("hi back", "2026-04-28T00:00:01.000Z"),
			userMsg("ask 2", "2026-04-28T00:00:02.000Z"),
			// Empty placeholder (e.g. mid-stream row that was never finalized)
			agentMsg("", "2026-04-28T00:00:03.000Z"),
			// Errored row
			agentMsg("partial", "2026-04-28T00:00:04.000Z", {
				finish_reason: "error",
				error_message: "boom",
			}),
		];
		const turns = assemblePrompt({
			systemPrompt: SYSTEM,
			chunks: [],
			history,
			userTurn: "third",
		});
		expect(turns.map((t) => `${t.role}:${t.content}`)).toEqual([
			`system:${SYSTEM}`,
			"user:hi",
			"assistant:hi back",
			"user:ask 2",
			"user:third",
		]);
	});

	test("trims history to the most recent N turns", () => {
		const history: MessageRecord[] = [];
		for (let i = 0; i < 30; i++) {
			history.push(
				userMsg(`u${i}`, new Date(2026, 3, 28, 0, 0, i * 2).toISOString()),
			);
			history.push(
				agentMsg(`a${i}`, new Date(2026, 3, 28, 0, 0, i * 2 + 1).toISOString()),
			);
		}
		const turns = assemblePrompt({
			systemPrompt: SYSTEM,
			chunks: [],
			history,
			userTurn: "now",
			historyLimit: 4,
		});
		// system + 4 history + 1 new user
		expect(turns).toHaveLength(6);
		// Most-recent 4 history turns are kept (u28, a28, u29, a29).
		expect(turns.slice(1, 5).map((t) => t.content)).toEqual([
			"u28",
			"a28",
			"u29",
			"a29",
		]);
		expect(turns[5]?.content).toBe("now");
	});
});
