/**
 * Constructs a {@link ChatService} from runtime config.
 *
 * Mirrors the {@link ../embeddings/factory.makeEmbedderFactory}
 * shape: dependencies in, async factory out, errors surfaced as
 * structured exceptions the caller can map to HTTP responses.
 *
 * The HF token is resolved once at construction and cached for the
 * lifetime of the returned service. Re-resolving on every chat
 * request would re-read `process.env` (cheap) but also re-run any
 * future provider that's expensive (vault, AWS Secrets Manager) —
 * cache once, fail loudly at boot if the ref is broken.
 */

import type { ChatConfig } from "../config/schema.js";
import type { SecretResolver } from "../secrets/provider.js";
import { HuggingFaceChatService } from "./huggingface.js";
import type { ChatService } from "./types.js";

export interface BuildChatServiceDeps {
	readonly config: ChatConfig | null | undefined;
	readonly secrets: SecretResolver;
}

/**
 * Returns a {@link ChatService} when `config` is set and the token
 * resolves; returns `null` when `config` is undefined (chat opt-out)
 * so the route layer can return a clear `503 chat_disabled`. Throws
 * when `config` is set but the token ref is malformed or
 * unresolvable — that's a startup-time misconfiguration and the
 * runtime should refuse to boot rather than 503 every chat request.
 */
export async function buildChatService(
	deps: BuildChatServiceDeps,
): Promise<ChatService | null> {
	if (!deps.config) return null;
	const token = await deps.secrets.resolve(deps.config.tokenRef);
	return new HuggingFaceChatService({
		token,
		modelId: deps.config.model,
		maxOutputTokens: deps.config.maxOutputTokens,
	});
}
