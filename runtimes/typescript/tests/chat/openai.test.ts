/**
 * Tests for the OpenAI chat-completions adapter. Uses a fake fetch
 * transport (no real network) — the goal is to lock down the wire
 * shape we send to OpenAI, the tool-call accumulation in the
 * streaming reader, and the error mapping.
 */

import { describe, expect, test } from "vitest";
import { OpenAIChatService } from "../../src/chat/openai.js";
import type {
	ChatCompletionRequest,
	ChatStreamEvent,
} from "../../src/chat/types.js";

interface CapturedRequest {
	url: string;
	body: Record<string, unknown>;
	headers: Record<string, string>;
}

function captureFetch(respond: (req: CapturedRequest) => Response): {
	captured: CapturedRequest[];
	fetchImpl: typeof fetch;
} {
	const captured: CapturedRequest[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const url = typeof input === "string" ? input : (input as URL).toString();
		const body = init?.body
			? (JSON.parse(init.body as string) as Record<string, unknown>)
			: {};
		const headers = init?.headers as Record<string, string>;
		const req: CapturedRequest = { url, body, headers };
		captured.push(req);
		return respond(req);
	};
	return { captured, fetchImpl };
}

function svc(opts: { fetchImpl: typeof fetch }): OpenAIChatService {
	return new OpenAIChatService({
		apiKey: "sk-fake",
		modelId: "gpt-4o-mini",
		maxOutputTokens: 256,
		fetchImpl: opts.fetchImpl,
	});
}

describe("OpenAIChatService.complete", () => {
	test("sends Bearer auth + tools[] + tool_choice when tools are advertised", async () => {
		const { captured, fetchImpl } = captureFetch(
			() =>
				new Response(
					JSON.stringify({
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: "hello" },
								finish_reason: "stop",
							},
						],
						usage: { total_tokens: 9 },
					}),
					{ status: 200 },
				),
		);
		const service = svc({ fetchImpl });
		const tools = [
			{
				name: "search_kb",
				description: "search",
				parameters: { type: "object" },
			},
		];
		const req: ChatCompletionRequest = {
			messages: [
				{ role: "system", content: "be terse" },
				{ role: "user", content: "hi" },
			],
			tools,
		};
		const out = await service.complete(req);
		expect(out.content).toBe("hello");
		expect(out.finishReason).toBe("stop");
		expect(out.toolCalls).toEqual([]);
		expect(out.tokenCount).toBe(9);
		expect(captured).toHaveLength(1);
		expect(captured[0]?.url).toMatch(/\/chat\/completions$/);
		expect(captured[0]?.headers.authorization).toBe("Bearer sk-fake");
		expect(captured[0]?.body.model).toBe("gpt-4o-mini");
		expect(captured[0]?.body.tools).toEqual([
			{
				type: "function",
				function: {
					name: "search_kb",
					description: "search",
					parameters: { type: "object" },
				},
			},
		]);
		expect(captured[0]?.body.tool_choice).toBe("auto");
	});

	test("omits tools[] / tool_choice when no tools are advertised", async () => {
		const { captured, fetchImpl } = captureFetch(
			() =>
				new Response(
					JSON.stringify({
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: "hi" },
								finish_reason: "stop",
							},
						],
					}),
					{ status: 200 },
				),
		);
		await svc({ fetchImpl }).complete({
			messages: [{ role: "user", content: "ping" }],
		});
		expect(captured[0]?.body.tools).toBeUndefined();
		expect(captured[0]?.body.tool_choice).toBeUndefined();
	});

	test("normalizes tool turns and assistant-with-tool_calls turns into the OpenAI shape", async () => {
		const { captured, fetchImpl } = captureFetch(
			() =>
				new Response(
					JSON.stringify({
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: "ok" },
								finish_reason: "stop",
							},
						],
					}),
					{ status: 200 },
				),
		);
		await svc({ fetchImpl }).complete({
			messages: [
				{ role: "user", content: "tool me" },
				{
					role: "assistant",
					content: "",
					toolCalls: [
						{
							id: "call_1",
							name: "search_kb",
							arguments: '{"query":"foo"}',
						},
					],
				},
				{
					role: "tool",
					toolCallId: "call_1",
					name: "search_kb",
					content: '{"results":[]}',
				},
			],
		});
		const sent = captured[0]?.body.messages as Array<Record<string, unknown>>;
		expect(sent).toHaveLength(3);
		// Assistant turn carries tool_calls and a NULL content (not "").
		expect(sent[1]).toMatchObject({
			role: "assistant",
			content: null,
			tool_calls: [
				{
					id: "call_1",
					type: "function",
					function: { name: "search_kb", arguments: '{"query":"foo"}' },
				},
			],
		});
		expect(sent[2]).toMatchObject({
			role: "tool",
			tool_call_id: "call_1",
			name: "search_kb",
			content: '{"results":[]}',
		});
	});

	test("surfaces tool_calls + tool_calls finishReason on a tool-calling response", async () => {
		const { fetchImpl } = captureFetch(
			() =>
				new Response(
					JSON.stringify({
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: null,
									tool_calls: [
										{
											id: "call_42",
											type: "function",
											function: {
												name: "search_kb",
												arguments: '{"query":"foo"}',
											},
										},
									],
								},
								finish_reason: "tool_calls",
							},
						],
					}),
					{ status: 200 },
				),
		);
		const out = await svc({ fetchImpl }).complete({
			messages: [{ role: "user", content: "search" }],
			tools: [{ name: "search_kb", description: "x", parameters: {} }],
		});
		expect(out.finishReason).toBe("tool_calls");
		expect(out.content).toBe("");
		expect(out.toolCalls).toEqual([
			{ id: "call_42", name: "search_kb", arguments: '{"query":"foo"}' },
		]);
	});

	test("non-2xx response becomes a finishReason='error' completion (no throw)", async () => {
		const { fetchImpl } = captureFetch(
			() =>
				new Response("rate limited", {
					status: 429,
					statusText: "Too Many Requests",
				}),
		);
		const out = await svc({ fetchImpl }).complete({
			messages: [{ role: "user", content: "hi" }],
		});
		expect(out.finishReason).toBe("error");
		expect(out.errorMessage).toMatch(/HTTP 429/);
		expect(out.content).toBe("");
		expect(out.toolCalls).toEqual([]);
	});
});

describe("OpenAIChatService.completeStream", () => {
	function sseResponse(events: string[]): Response {
		const body = events
			.map((e) => `data: ${e}\n\n`)
			.concat(["data: [DONE]\n\n"])
			.join("");
		return new Response(body, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}

	test("yields tokens, then a terminal done with content + tokenCount", async () => {
		const { fetchImpl } = captureFetch(() =>
			sseResponse([
				JSON.stringify({
					choices: [
						{ index: 0, delta: { content: "hel" }, finish_reason: null },
					],
				}),
				JSON.stringify({
					choices: [
						{ index: 0, delta: { content: "lo" }, finish_reason: null },
					],
				}),
				JSON.stringify({
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { total_tokens: 7 },
				}),
			]),
		);
		const events: ChatStreamEvent[] = [];
		for await (const ev of svc({ fetchImpl }).completeStream({
			messages: [{ role: "user", content: "say hi" }],
		})) {
			events.push(ev);
		}
		const tokens = events
			.filter((e) => e.type === "token")
			.map((e) => (e.type === "token" ? e.delta : ""));
		expect(tokens).toEqual(["hel", "lo"]);
		const done = events.find((e) => e.type === "done");
		expect(done).toMatchObject({
			type: "done",
			content: "hello",
			finishReason: "stop",
			tokenCount: 7,
			toolCalls: [],
		});
	});

	test("accumulates tool-call deltas across chunks, surfaces them on done", async () => {
		const { fetchImpl } = captureFetch(() =>
			sseResponse([
				JSON.stringify({
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "call_1",
										type: "function",
										function: { name: "search_kb", arguments: "" },
									},
								],
							},
							finish_reason: null,
						},
					],
				}),
				JSON.stringify({
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{ index: 0, function: { arguments: '{"query":' } },
								],
							},
							finish_reason: null,
						},
					],
				}),
				JSON.stringify({
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [{ index: 0, function: { arguments: '"foo"}' } }],
							},
							finish_reason: null,
						},
					],
				}),
				JSON.stringify({
					choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
				}),
			]),
		);
		const events: ChatStreamEvent[] = [];
		for await (const ev of svc({ fetchImpl }).completeStream({
			messages: [{ role: "user", content: "search" }],
			tools: [{ name: "search_kb", description: "x", parameters: {} }],
		})) {
			events.push(ev);
		}
		const done = events.find((e) => e.type === "done");
		expect(done).toMatchObject({
			type: "done",
			finishReason: "tool_calls",
			toolCalls: [
				{ id: "call_1", name: "search_kb", arguments: '{"query":"foo"}' },
			],
		});
	});
});
