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

	test("propagates persisted tool_calls onto the assistant turn", () => {
		const toolCallAssistant: MessageRecord = {
			...agentMsg("", "2026-04-28T00:00:01.000Z"),
			toolCallPayload: {
				toolCalls: [
					{
						id: "call_a",
						name: "kb.search",
						arguments: '{"query":"hello"}',
					},
				],
			},
		};
		const toolResult: MessageRecord = {
			...agentMsg("", "2026-04-28T00:00:02.000Z"),
			role: "tool",
			toolId: "kb.search",
			toolResponse: {
				toolCallId: "call_a",
				content: "results: ...",
			},
		};
		const turns = assemblePrompt({
			systemPrompt: SYSTEM,
			chunks: [],
			history: [userMsg("find me docs"), toolCallAssistant, toolResult],
			userTurn: "thanks",
		});
		// system, user, assistant(toolCalls), tool, user
		expect(turns).toHaveLength(5);
		const asst = turns[2];
		expect(asst?.role).toBe("assistant");
		expect(
			(asst as { role: "assistant"; toolCalls?: readonly unknown[] }).toolCalls,
		).toEqual([
			{ id: "call_a", name: "kb.search", arguments: '{"query":"hello"}' },
		]);
		expect(turns[3]).toEqual({
			role: "tool",
			toolCallId: "call_a",
			name: "kb.search",
			content: "results: ...",
		});
	});

	test("silently drops malformed entries in toolCallPayload", () => {
		const malformed: MessageRecord = {
			...agentMsg("fallback content", "2026-04-28T00:00:01.000Z"),
			toolCallPayload: {
				toolCalls: [
					null,
					{ id: 42 }, // wrong type for id
					{ id: "ok", name: "kb.search" }, // missing arguments
					"not-an-object",
					{
						id: "call_z",
						name: "kb.search",
						arguments: "{}",
					},
				],
			},
		};
		const turns = assemblePrompt({
			systemPrompt: SYSTEM,
			chunks: [],
			history: [userMsg("hi"), malformed],
			userTurn: "?",
		});
		const asst = turns.find((t) => t.role === "assistant") as
			| { role: "assistant"; toolCalls?: readonly { id: string }[] }
			| undefined;
		expect(asst?.toolCalls?.map((c) => c.id)).toEqual(["call_z"]);
	});

	test("treats null toolCallPayload and missing toolCalls array as no tool calls", () => {
		const nullPayload: MessageRecord = {
			...agentMsg("answer", "2026-04-28T00:00:01.000Z"),
			toolCallPayload: null,
		};
		const missingArray: MessageRecord = {
			...agentMsg("answer2", "2026-04-28T00:00:02.000Z"),
			toolCallPayload: { somethingElse: "x" },
		};
		const turns = assemblePrompt({
			systemPrompt: SYSTEM,
			chunks: [],
			history: [userMsg("q"), nullPayload, missingArray],
			userTurn: "k",
		});
		// Both assistant turns appear as plain text.
		const assistants = turns.filter((t) => t.role === "assistant");
		expect(assistants.map((t) => t.content)).toEqual(["answer", "answer2"]);
	});

	test("drops tool turns missing a structurally valid toolResponse", () => {
		const incompleteToolRow: MessageRecord = {
			...agentMsg("", "2026-04-28T00:00:02.000Z"),
			role: "tool",
			toolId: "kb.search",
			toolResponse: { toolCallId: "call_x" }, // no content
		};
		const noToolIdRow: MessageRecord = {
			...agentMsg("", "2026-04-28T00:00:03.000Z"),
			role: "tool",
			toolId: null,
			toolResponse: { toolCallId: "call_x", content: "x" },
		};
		const turns = assemblePrompt({
			systemPrompt: SYSTEM,
			chunks: [],
			history: [userMsg("q"), incompleteToolRow, noToolIdRow],
			userTurn: "k",
		});
		expect(turns.some((t) => t.role === "tool")).toBe(false);
	});

	test("strips orphan tool turns at the head when their assistant got trimmed", () => {
		// Build > limit turns where the first tool's assistant gets cut off.
		const toolCallAssistant: MessageRecord = {
			...agentMsg("", "2026-04-28T00:00:01.000Z"),
			toolCallPayload: {
				toolCalls: [{ id: "call_old", name: "kb.search", arguments: "{}" }],
			},
		};
		const orphanedTool: MessageRecord = {
			...agentMsg("", "2026-04-28T00:00:02.000Z"),
			role: "tool",
			toolId: "kb.search",
			toolResponse: { toolCallId: "call_old", content: "old result" },
		};
		const filler: MessageRecord[] = [];
		for (let i = 0; i < 6; i++) {
			filler.push(
				userMsg(`u${i}`, new Date(2026, 3, 28, 1, 0, i * 2).toISOString()),
			);
			filler.push(
				agentMsg(`a${i}`, new Date(2026, 3, 28, 1, 0, i * 2 + 1).toISOString()),
			);
		}
		const turns = assemblePrompt({
			systemPrompt: SYSTEM,
			chunks: [],
			history: [toolCallAssistant, orphanedTool, ...filler],
			userTurn: "now",
			historyLimit: 6,
		});
		// The orphaned tool turn would otherwise appear at the head of the
		// trimmed slice — confirm it was stripped.
		expect(turns.some((t) => t.role === "tool")).toBe(false);
	});

	test("skips role:system history entries — system is rebuilt per turn", () => {
		const systemHistory: MessageRecord = {
			...agentMsg("ignored", "2026-04-28T00:00:01.000Z"),
			role: "system",
			content: "stale system",
		};
		const turns = assemblePrompt({
			systemPrompt: SYSTEM,
			chunks: [],
			history: [systemHistory, userMsg("q")],
			userTurn: "k",
		});
		expect(turns.filter((t) => t.role === "system")).toHaveLength(1);
		expect(turns[0]?.content).toBe(SYSTEM);
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
