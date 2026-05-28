/**
 * Route-level coverage for `GET /api/v1/llm-models` (the model picker's
 * data source). Mounts the router directly with an injected fetch so
 * the provider catalog is exercised without real network.
 */

import { describe, expect, test, vi } from "vitest";
import { llmModelsRoutes } from "../src/routes/api-v1/llm-models.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

describe("GET /llm-models", () => {
	test("defaults to openrouter and returns the live tool-calling catalog", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				data: [
					{
						id: "openai/gpt-4o-mini",
						name: "OpenAI: GPT-4o mini",
						supported_parameters: ["tools"],
					},
				],
			}),
		) as unknown as typeof fetch;
		const app = llmModelsRoutes({ chatConfig: null, fetchImpl });

		const res = await app.request("/llm-models");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.provider).toBe("openrouter");
		expect(body.source).toBe("live");
		expect(body.models[0].id).toBe("openai/gpt-4o-mini");
	});

	test("provider=ollama falls back to a curated list when the server is down", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		const app = llmModelsRoutes({ chatConfig: null, fetchImpl });

		const res = await app.request("/llm-models?provider=ollama");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.provider).toBe("ollama");
		expect(body.source).toBe("fallback");
		expect(body.models.length).toBeGreaterThan(0);
	});

	test("rejects an unsupported provider via the query enum (422)", async () => {
		const app = llmModelsRoutes({ chatConfig: null });
		const res = await app.request("/llm-models?provider=huggingface");
		expect(res.status).toBe(400);
	});
});
