/**
 * Tests for `buildChatService`, the factory the runtime calls at
 * boot to materialize a chat service from config.
 *
 * Branches that matter to the chat-default-on UX:
 *
 *   - `config: null` → returns null (legacy callers / direct
 *     test injection).
 *   - `config.enabled: false` → explicit opt-out, returns null
 *     without trying to resolve the token.
 *   - `config.enabled: true` (default) + unresolved token →
 *     returns null with a `warn` log so the runtime keeps booting
 *     and `/settings` can fix the credential. The wizard / post-setup
 *     bootstrap path.
 *   - healthy OpenRouter path → an OpenAIChatService pointed at
 *     OpenRouter.
 *   - Ollama → builds with no credential (local/unauthenticated).
 */

import { describe, expect, test } from "vitest";
import { buildChatService } from "../../src/chat/factory.js";
import type { ChatConfig } from "../../src/config/schema.js";
import {
	type SecretProvider,
	SecretResolver,
} from "../../src/secrets/provider.js";

class StubSecretsProvider implements SecretProvider {
	async resolve(path: string): Promise<string> {
		return path;
	}
}

class RejectingSecretsProvider implements SecretProvider {
	async resolve(): Promise<string> {
		throw new Error("env var 'OPENROUTER_API_KEY' is not set");
	}
}

const resolvingSecrets = new SecretResolver({
	stub: new StubSecretsProvider(),
});

const rejectingSecrets = new SecretResolver({
	env: new RejectingSecretsProvider(),
});

/** Build a ChatConfig with sensible defaults, overridable per test. */
function chatConfig(overrides: Partial<ChatConfig>): ChatConfig {
	return {
		enabled: true,
		provider: "openrouter",
		tokenRef: "stub:openrouter-key",
		baseUrl: null,
		model: "openai/gpt-4o-mini",
		maxOutputTokens: 128,
		retrievalK: 4,
		allowDataCollection: false,
		systemPrompt: null,
		...overrides,
	};
}

describe("buildChatService", () => {
	test("returns null when config is null (no chat block / direct opt-out)", async () => {
		const svc = await buildChatService({
			config: null,
			secrets: resolvingSecrets,
		});
		expect(svc).toBeNull();
	});

	test("returns null when config.enabled is false (explicit operator opt-out)", async () => {
		const svc = await buildChatService({
			config: chatConfig({ enabled: false }),
			secrets: resolvingSecrets,
		});
		expect(svc).toBeNull();
	});

	test("returns null when the token ref does not resolve (bootstrap path)", async () => {
		const svc = await buildChatService({
			config: chatConfig({ tokenRef: "env:OPENROUTER_API_KEY" }),
			secrets: rejectingSecrets,
		});
		expect(svc).toBeNull();
	});

	test("returns an OpenRouter-backed service when enabled and token resolves", async () => {
		const svc = await buildChatService({
			config: chatConfig({ model: "fake-model" }),
			secrets: resolvingSecrets,
		});
		expect(svc).not.toBeNull();
		expect(svc?.modelId).toBe("fake-model");
		expect(svc?.providerId).toBe("openrouter");
	});

	test("builds a local Ollama service with no credential (rejecting secrets is fine)", async () => {
		const svc = await buildChatService({
			config: chatConfig({ provider: "ollama", model: "llama3.1" }),
			// Even though the resolver would throw, Ollama never calls it.
			secrets: rejectingSecrets,
		});
		expect(svc).not.toBeNull();
		expect(svc?.providerId).toBe("ollama");
	});
});
