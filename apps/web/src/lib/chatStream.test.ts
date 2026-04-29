import { describe, expect, it, vi } from "vitest";
import { type ChatStreamUiEvent, sendChatStream } from "@/lib/chatStream";

const stubFetch = vi.fn();
vi.stubGlobal("fetch", stubFetch);

function streamFromChunks(
	chunks: readonly string[],
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

describe("sendChatStream", () => {
	it("parses user-message, token deltas, and done events in order", async () => {
		const userMsg = {
			workspaceId: "00000000-0000-4000-8000-000000000001",
			chatId: "00000000-0000-4000-8000-000000000002",
			messageId: "00000000-0000-4000-8000-000000000003",
			messageTs: "2026-04-28T00:00:00.000Z",
			role: "user",
			content: "hi",
			tokenCount: null,
			metadata: {},
		};
		const assistantMsg = {
			...userMsg,
			messageId: "00000000-0000-4000-8000-000000000004",
			messageTs: "2026-04-28T00:00:01.000Z",
			role: "agent",
			content: "hello back",
			metadata: { finish_reason: "stop" },
		};
		const body = streamFromChunks([
			`event: user-message\ndata: ${JSON.stringify(userMsg)}\n\n`,
			`event: token\ndata: ${JSON.stringify({ delta: "hello " })}\n\n`,
			`event: token\ndata: ${JSON.stringify({ delta: "back" })}\n\n`,
			`event: done\ndata: ${JSON.stringify(assistantMsg)}\n\n`,
		]);
		stubFetch.mockResolvedValueOnce(
			new Response(body, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}),
		);

		const events: ChatStreamUiEvent[] = [];
		await sendChatStream("ws", "chat", {
			content: "hi",
			onEvent: (e) => events.push(e),
		});

		expect(events.map((e) => e.type)).toEqual([
			"user-message",
			"token",
			"token",
			"done",
		]);
		const tokens = events
			.filter((e): e is { type: "token"; delta: string } => e.type === "token")
			.map((e) => e.delta);
		expect(tokens.join("")).toBe("hello back");
	});

	it("handles SSE chunks split mid-event across reads", async () => {
		const assistantMsg = {
			workspaceId: "00000000-0000-4000-8000-000000000001",
			chatId: "00000000-0000-4000-8000-000000000002",
			messageId: "00000000-0000-4000-8000-000000000004",
			messageTs: "2026-04-28T00:00:01.000Z",
			role: "agent",
			content: "ok",
			tokenCount: null,
			metadata: { finish_reason: "stop" },
		};
		const full = `event: token\ndata: ${JSON.stringify({ delta: "o" })}\n\nevent: token\ndata: ${JSON.stringify({ delta: "k" })}\n\nevent: done\ndata: ${JSON.stringify(assistantMsg)}\n\n`;
		// Split the byte stream at an awkward offset (mid-event).
		const half = Math.floor(full.length / 2);
		const body = streamFromChunks([full.slice(0, half), full.slice(half)]);
		stubFetch.mockResolvedValueOnce(
			new Response(body, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}),
		);

		const tokens: string[] = [];
		let done = false;
		await sendChatStream("ws", "chat", {
			content: "hi",
			onEvent: (e) => {
				if (e.type === "token") tokens.push(e.delta);
				if (e.type === "done") done = true;
			},
		});
		expect(tokens.join("")).toBe("ok");
		expect(done).toBe(true);
	});

	it("rejects on a non-2xx response", async () => {
		stubFetch.mockResolvedValueOnce(
			new Response("chat is disabled", {
				status: 503,
				statusText: "Service Unavailable",
			}),
		);
		await expect(
			sendChatStream("ws", "chat", { content: "hi", onEvent: () => {} }),
		).rejects.toThrow(/503/);
	});
});
