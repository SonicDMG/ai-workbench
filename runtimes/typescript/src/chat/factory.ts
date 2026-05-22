/**
 * Constructs a {@link ChatService} from runtime config.
 *
 * Mirrors the {@link ../embeddings/factory.makeEmbedderFactory}
 * shape: dependencies in, async factory out.
 *
 * The HF token is resolved once at construction and cached for the
 * lifetime of the returned service. Re-resolving on every chat
 * request would re-read `process.env` (cheap) but also re-run any
 * future provider that's expensive (vault, AWS Secrets Manager) —
 * cache once.
 */

import type { ChatConfig } from "../config/schema.js";
import { logger } from "../lib/logger.js";
import type { SecretResolver } from "../secrets/provider.js";
import { HuggingFaceChatService } from "./huggingface.js";
import type { ChatService } from "./types.js";

export interface BuildChatServiceDeps {
	readonly config: ChatConfig | null | undefined;
	readonly secrets: SecretResolver;
}

/**
 * Returns a {@link ChatService} when `config` is set and the token
 * resolves; returns `null` when `config` is undefined (chat opt-out),
 * or when `config` is set but the token ref does not resolve — the
 * latter case is the wizard's bootstrap path: a fresh install boots
 * with `chat.tokenRef: env:HUGGINGFACE_API_KEY` declared but the env
 * unset, the setup wizard writes the key via POST /setup/env, the
 * runtime restarts and picks up the token on the second boot. Until
 * then the agent send routes return `503 chat_disabled` (same as a
 * runtime with no `chat:` block at all).
 */
export async function buildChatService(
	deps: BuildChatServiceDeps,
): Promise<ChatService | null> {
	if (!deps.config) return null;
	let token: string;
	try {
		token = await deps.secrets.resolve(deps.config.tokenRef);
	} catch (err) {
		logger.warn(
			{
				ref: deps.config.tokenRef,
				err: err instanceof Error ? err.message : String(err),
			},
			"chat token ref did not resolve; chat will report 503 chat_disabled until the secret is set and the runtime restarts",
		);
		return null;
	}
	return new HuggingFaceChatService({
		token,
		modelId: deps.config.model,
		maxOutputTokens: deps.config.maxOutputTokens,
	});
}
