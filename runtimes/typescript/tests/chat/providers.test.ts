/**
 * Unit coverage for the OpenAI-compatible provider registry. These are
 * the per-provider facts (base URL, credential requirement, OpenRouter
 * attribution headers + ZDR routing) that both the global chat factory
 * and the per-agent resolver build their adapter from.
 */

import { describe, expect, test } from "vitest";
import {
	chatProviderProfile,
	isChatProviderId,
	OLLAMA_DEFAULT_BASE_URL,
	OPENROUTER_BASE_URL,
	ollamaBaseUrl,
	resolveChatProvider,
} from "../../src/chat/providers.js";

describe("isChatProviderId / chatProviderProfile", () => {
	test("recognizes the three wired providers", () => {
		expect(isChatProviderId("openrouter")).toBe(true);
		expect(isChatProviderId("openai")).toBe(true);
		expect(isChatProviderId("ollama")).toBe(true);
	});

	test("rejects the removed HuggingFace provider and unknowns", () => {
		expect(isChatProviderId("huggingface")).toBe(false);
		expect(isChatProviderId("vertex")).toBe(false);
		expect(chatProviderProfile("huggingface")).toBeNull();
	});

	test("only ollama is credential-free", () => {
		expect(chatProviderProfile("openrouter")?.requiresCredential).toBe(true);
		expect(chatProviderProfile("openai")?.requiresCredential).toBe(true);
		expect(chatProviderProfile("ollama")?.requiresCredential).toBe(false);
	});
});

describe("resolveChatProvider", () => {
	test("openrouter: attribution headers + ZDR deny by default", () => {
		const r = resolveChatProvider({ provider: "openrouter" });
		expect(r?.baseUrl).toBe(OPENROUTER_BASE_URL);
		expect(r?.defaultHeaders?.["X-Title"]).toBe("AI Workbench");
		expect(r?.defaultHeaders?.["HTTP-Referer"]).toBeTruthy();
		// ZDR-only: tell OpenRouter to route to non-retaining upstreams.
		expect(r?.extraBody).toEqual({ provider: { data_collection: "deny" } });
	});

	test("openrouter: allowDataCollection drops the ZDR routing hint", () => {
		const r = resolveChatProvider({
			provider: "openrouter",
			allowDataCollection: true,
		});
		expect(r?.extraBody).toBeUndefined();
	});

	test("ollama: localhost base URL, no headers, no body extras", () => {
		const r = resolveChatProvider({ provider: "ollama" });
		expect(r?.baseUrl).toBe(OLLAMA_DEFAULT_BASE_URL);
		expect(r?.defaultHeaders).toBeUndefined();
		expect(r?.extraBody).toBeUndefined();
	});

	test("explicit baseUrl overrides the provider default", () => {
		const r = resolveChatProvider({
			provider: "ollama",
			baseUrl: "http://gpu-box.lan:11434/v1",
		});
		expect(r?.baseUrl).toBe("http://gpu-box.lan:11434/v1");
	});

	test("unknown provider resolves to null", () => {
		expect(resolveChatProvider({ provider: "huggingface" })).toBeNull();
	});

	test("OLLAMA_BASE_URL env steers the ollama fallback (#361)", () => {
		process.env.OLLAMA_BASE_URL = "http://host.docker.internal:11434/v1";
		try {
			const r = resolveChatProvider({ provider: "ollama" });
			expect(r?.baseUrl).toBe("http://host.docker.internal:11434/v1");
			// Per-service endpointBaseUrl still wins over the env default.
			const explicit = resolveChatProvider({
				provider: "ollama",
				baseUrl: "http://gpu-box.lan:11434/v1",
			});
			expect(explicit?.baseUrl).toBe("http://gpu-box.lan:11434/v1");
			// Other providers are untouched by the Ollama env override.
			expect(resolveChatProvider({ provider: "openrouter" })?.baseUrl).toBe(
				OPENROUTER_BASE_URL,
			);
		} finally {
			delete process.env.OLLAMA_BASE_URL;
		}
	});
});

describe("ollamaBaseUrl", () => {
	test("falls back to localhost when the env is unset", () => {
		expect(ollamaBaseUrl({})).toBe(OLLAMA_DEFAULT_BASE_URL);
		expect(ollamaBaseUrl({ OLLAMA_BASE_URL: "   " })).toBe(
			OLLAMA_DEFAULT_BASE_URL,
		);
	});

	test("appends /v1 to a bare origin and strips trailing slashes", () => {
		expect(ollamaBaseUrl({ OLLAMA_BASE_URL: "http://h.lan:11434" })).toBe(
			"http://h.lan:11434/v1",
		);
		expect(ollamaBaseUrl({ OLLAMA_BASE_URL: "http://h.lan:11434/" })).toBe(
			"http://h.lan:11434/v1",
		);
	});

	test("leaves an explicit path alone", () => {
		expect(
			ollamaBaseUrl({ OLLAMA_BASE_URL: "http://h.lan:8080/ollama/v1" }),
		).toBe("http://h.lan:8080/ollama/v1");
		expect(ollamaBaseUrl({ OLLAMA_BASE_URL: "http://h.lan:11434/v1/" })).toBe(
			"http://h.lan:11434/v1",
		);
	});
});
