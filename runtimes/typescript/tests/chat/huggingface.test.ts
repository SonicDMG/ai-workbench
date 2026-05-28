/**
 * Unit coverage for the HuggingFace chat adapter's native
 * function-calling wiring.
 *
 * Regression target: the adapter used to ignore `request.tools` and
 * never parse `tool_calls`, so a tool-using agent (Bobby) on an
 * HF-backed model emitted its tool calls as plain-text code blocks the
 * dispatcher couldn't execute. The adapter now forwards `tools[]` +
 * `tool_choice` and parses the model's structured `tool_calls`.
 *
 * The `@huggingface/inference` SDK client isn't injectable, so we mock
 * the module and assert against the args our adapter hands the SDK and
 * the outcomes it derives from the SDK's response.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const { chatCompletion, chatCompletionStream } = vi.hoisted(() => ({
	chatCompletion: vi.fn(),
	chatCompletionStream: vi.fn(),
}));

vi.mock("@huggingface/inference", () => ({
	InferenceClient: class {
		chatCompletion = chatCompletion;
		chatCompletionStream = chatCompletionStream;
	},
}));

import { HuggingFaceChatService } from "../../src/chat/huggingface.js";
import type { ChatTurn, ToolDefinition } from "../../src/chat/types.js";

const TOOL: ToolDefinition = {
	name: "list_kbs",
	description: "List knowledge bases",
	parameters: { type: "object", properties: {} },
};

function svc() {
	return new HuggingFaceChatService({
		token: "hf_x",
		modelId: "openai/gpt-oss-20b",
		maxOutputTokens: 64,
	});
}

beforeEach(() => {
	chatCompletion.mockReset();
	chatCompletionStream.mockReset();
});

describe("HuggingFaceChatService.complete tools", () => {
	test("forwards tools[] + tool_choice and parses tool_calls", async () => {
		chatCompletion.mockResolvedValue({
			choices: [
				{
					message: {
						content: "",
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "list_kbs", arguments: '{"limit":5}' },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
			usage: { total_tokens: 12 },
		});

		const out = await svc().complete({
			messages: [{ role: "user", content: "what data do i have?" }],
			tools: [TOOL],
		});

		// Parsed the structured tool call rather than treating text as final.
		expect(out.toolCalls).toEqual([
			{ id: "call_1", name: "list_kbs", arguments: '{"limit":5}' },
		]);
		expect(out.finishReason).toBe("tool_calls");
		expect(out.errorMessage).toBeNull();

		// Forwarded the OpenAI-compatible tools[] + tool_choice.
		const args = (chatCompletion.mock.calls[0]?.[0] ?? {}) as Record<
			string,
			unknown
		>;
		expect(args.tool_choice).toBe("auto");
		expect(args.tools).toEqual([
			{
				type: "function",
				function: {
					name: "list_kbs",
					description: "List knowledge bases",
					parameters: { type: "object", properties: {} },
				},
			},
		]);
	});

	test("omits the tools field entirely when the agent advertises none", async () => {
		chatCompletion.mockResolvedValue({
			choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
			usage: { total_tokens: 3 },
		});

		const out = await svc().complete({
			messages: [{ role: "user", content: "hi" }],
		});

		expect(out.content).toBe("hello");
		expect(out.toolCalls).toEqual([]);
		const args = (chatCompletion.mock.calls[0]?.[0] ?? {}) as Record<
			string,
			unknown
		>;
		expect("tools" in args).toBe(false);
		expect("tool_choice" in args).toBe(false);
	});

	test("maps assistant tool_calls and tool-result turns into OpenAI shape", async () => {
		chatCompletion.mockResolvedValue({
			choices: [{ message: { content: "done" }, finish_reason: "stop" }],
		});

		const history: ChatTurn[] = [
			{ role: "user", content: "what data do i have?" },
			{
				role: "assistant",
				content: "",
				toolCalls: [{ id: "call_1", name: "list_kbs", arguments: "{}" }],
			},
			{
				role: "tool",
				toolCallId: "call_1",
				name: "list_kbs",
				content: '["kb-a"]',
			},
		];

		await svc().complete({ messages: history, tools: [TOOL] });

		const sent =
			(
				(chatCompletion.mock.calls[0]?.[0] ?? {}) as {
					messages?: Record<string, unknown>[];
				}
			).messages ?? [];
		// Assistant turn carries its tool_calls (so the model sees its own
		// prior invocation), tool turn becomes role:"tool" + tool_call_id.
		expect(sent[1]).toMatchObject({
			role: "assistant",
			tool_calls: [
				{
					id: "call_1",
					type: "function",
					function: { name: "list_kbs", arguments: "{}" },
				},
			],
		});
		expect(sent[2]).toMatchObject({
			role: "tool",
			tool_call_id: "call_1",
			name: "list_kbs",
			content: '["kb-a"]',
		});
	});

	test("converts SDK exceptions into a finishReason:error outcome", async () => {
		chatCompletion.mockRejectedValue(new Error("429 rate limited"));

		const out = await svc().complete({
			messages: [{ role: "user", content: "hi" }],
		});

		expect(out.finishReason).toBe("error");
		expect(out.errorMessage).toMatch(/429 rate limited/);
		expect(out.toolCalls).toEqual([]);
	});
});

describe("HuggingFaceChatService.completeStream tools", () => {
	test("accumulates streamed tool_call deltas and emits them on done", async () => {
		// The SDK yields tool-call args in fragments keyed by index.
		async function* fakeStream() {
			yield {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									function: { name: "list_kbs", arguments: '{"li' },
								},
							],
						},
						finish_reason: null,
					},
				],
			};
			yield {
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, function: { arguments: 'mit":5}' } }],
						},
						finish_reason: "tool_calls",
					},
				],
				usage: { total_tokens: 9 },
			};
		}
		chatCompletionStream.mockReturnValue(fakeStream());

		const events = [];
		for await (const ev of svc().completeStream({
			messages: [{ role: "user", content: "what data do i have?" }],
			tools: [TOOL],
		})) {
			events.push(ev);
		}

		const done = events.at(-1);
		expect(done?.type).toBe("done");
		if (done?.type === "done") {
			expect(done.toolCalls).toEqual([
				{ id: "call_1", name: "list_kbs", arguments: '{"limit":5}' },
			]);
			expect(done.finishReason).toBe("tool_calls");
		}
	});
});
