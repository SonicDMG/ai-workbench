/**
 * Tests for `buildChatService`, the factory the runtime calls at
 * boot to materialize a chat service from config.
 *
 * Three branches matter to the chat-default-on UX:
 *
 *   - `config: null` → returns null (legacy callers / direct
 *     test injection).
 *   - `config.enabled: false` → explicit opt-out, returns null
 *     without trying to resolve the token. Operators who don't
 *     want chat add this to `workbench.yaml`.
 *   - `config.enabled: true` (default) + unresolved token →
 *     returns null with a `warn` log so the runtime keeps booting
 *     and `/settings` can fix the credential. This is the wizard /
 *     post-setup bootstrap path.
 *
 * The healthy "token resolves → HuggingFaceChatService" path is
 * covered indirectly by the dispatcher integration tests.
 */

import { describe, expect, test } from "vitest";
import { buildChatService } from "../../src/chat/factory.js";
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
		throw new Error("env var 'HUGGINGFACE_API_KEY' is not set");
	}
}

const resolvingSecrets = new SecretResolver({
	stub: new StubSecretsProvider(),
});

const rejectingSecrets = new SecretResolver({
	env: new RejectingSecretsProvider(),
});

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
			config: {
				enabled: false,
				tokenRef: "stub:would-resolve",
				model: "x",
				maxOutputTokens: 1,
				retrievalK: 1,
				systemPrompt: null,
			},
			secrets: resolvingSecrets,
		});
		expect(svc).toBeNull();
	});

	test("returns null when the token ref does not resolve (bootstrap path)", async () => {
		const svc = await buildChatService({
			config: {
				enabled: true,
				tokenRef: "env:HUGGINGFACE_API_KEY",
				model: "mistralai/Mistral-7B-Instruct-v0.3",
				maxOutputTokens: 1024,
				retrievalK: 6,
				systemPrompt: null,
			},
			secrets: rejectingSecrets,
		});
		expect(svc).toBeNull();
	});

	test("returns a HuggingFaceChatService when enabled is true and token resolves", async () => {
		const svc = await buildChatService({
			config: {
				enabled: true,
				tokenRef: "stub:fake-hf-token",
				model: "fake-model",
				maxOutputTokens: 128,
				retrievalK: 4,
				systemPrompt: null,
			},
			secrets: resolvingSecrets,
		});
		expect(svc).not.toBeNull();
		expect(svc?.modelId).toBe("fake-model");
		expect(svc?.providerId).toBe("huggingface");
	});
});
