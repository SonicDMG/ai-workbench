/**
 * Tests for the live chat-model catalog. Uses a fake fetch transport —
 * no real network. Locks down the OpenRouter tool-calling filter +
 * recommended ordering, the Ollama mapping, and the fallback behavior
 * when the upstream is unreachable (offline / outage).
 */

import { describe, expect, test, vi } from "vitest";
import { listChatModels } from "../../src/chat/model-catalog.js";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

describe("listChatModels — openrouter", () => {
	test("filters to tool-calling models and sorts recommended first", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				data: [
					{ id: "zzz/no-tools", name: "No Tools", supported_parameters: [] },
					{
						id: "openai/gpt-5.5",
						name: "OpenAI: GPT-5.5",
						supported_parameters: ["tools", "temperature"],
					},
					{
						id: "acme/aaa-toolmodel",
						name: "Acme AAA",
						supported_parameters: ["tools"],
					},
				],
			}),
		) as unknown as typeof fetch;

		const out = await listChatModels({ provider: "openrouter", fetchImpl });
		expect(out.source).toBe("live");
		// "no-tools" dropped; recommended gpt-5.5 first, then the
		// non-recommended tool model alphabetically.
		expect(out.models.map((m) => m.id)).toEqual([
			"openai/gpt-5.5",
			"acme/aaa-toolmodel",
		]);
		expect(out.models[0]?.recommended).toBe(true);
		expect(out.models[1]?.recommended).toBe(false);
		expect(out.models.every((m) => m.supportsTools === true)).toBe(true);
	});

	test("falls back to the curated static list when the request fails", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ error: "boom" }, 503),
		) as unknown as typeof fetch;
		const out = await listChatModels({ provider: "openrouter", fetchImpl });
		expect(out.source).toBe("fallback");
		expect(out.models.length).toBeGreaterThan(0);
		expect(out.models.some((m) => m.id === "openai/gpt-5.5")).toBe(true);
	});

	test("falls back when the live catalog has zero tool models", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				data: [{ id: "x/y", name: "X", supported_parameters: [] }],
			}),
		) as unknown as typeof fetch;
		const out = await listChatModels({ provider: "openrouter", fetchImpl });
		expect(out.source).toBe("fallback");
	});
});

describe("listChatModels — ollama", () => {
	test("maps the local OpenAI-compatible /models list (capabilities unknown)", async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			expect(url).toBe("http://localhost:11434/v1/models");
			return jsonResponse({
				data: [{ id: "llama3.1" }, { id: "nomic-embed-text" }],
			});
		}) as unknown as typeof fetch;
		const out = await listChatModels({ provider: "ollama", fetchImpl });
		expect(out.source).toBe("live");
		expect(out.models.map((m) => m.id)).toEqual([
			"llama3.1",
			"nomic-embed-text",
		]);
		expect(out.models[0]?.supportsTools).toBeNull();
	});

	test("honors a baseUrl override", async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			expect(url).toBe("http://gpu-box.lan:11434/v1/models");
			return jsonResponse({ data: [{ id: "qwen2.5" }] });
		}) as unknown as typeof fetch;
		const out = await listChatModels({
			provider: "ollama",
			baseUrl: "http://gpu-box.lan:11434/v1",
			fetchImpl,
		});
		expect(out.models[0]?.id).toBe("qwen2.5");
	});

	test("falls back when the local server is down", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		const out = await listChatModels({ provider: "ollama", fetchImpl });
		expect(out.source).toBe("fallback");
		expect(out.models.some((m) => m.id === "llama3.1")).toBe(true);
	});
});

describe("listChatModels — openai / unknown", () => {
	test("openai returns a curated static set without fetching", async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		const out = await listChatModels({ provider: "openai", fetchImpl });
		expect(out.source).toBe("fallback");
		expect(out.models.some((m) => m.id === "gpt-5.5")).toBe(true);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test("unknown provider yields an empty fallback", async () => {
		const out = await listChatModels({ provider: "vertex" });
		expect(out.models).toEqual([]);
	});
});
