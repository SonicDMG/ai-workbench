/**
 * Constructs a {@link ChatService} from runtime config.
 *
 * Mirrors the {@link ../embeddings/factory.makeEmbedderFactory}
 * shape: dependencies in, async factory out.
 *
 * Every wired provider is OpenAI-compatible, so a single
 * {@link OpenAIChatService} backs all of them — {@link
 * resolveChatProvider} supplies the base URL, headers, and request
 * extras per provider. The credential is resolved once at construction
 * and cached for the lifetime of the returned service; re-resolving on
 * every request would be cheap for `env:` but expensive for future
 * providers (vault, AWS Secrets Manager).
 */

import type { ChatConfig } from "../config/schema.js";
import { logger } from "../lib/logger.js";
import type { SecretResolver } from "../secrets/provider.js";
import { OpenAIChatService } from "./openai.js";
import { resolveChatProvider } from "./providers.js";
import type { ChatService } from "./types.js";

export interface BuildChatServiceDeps {
	readonly config: ChatConfig | null | undefined;
	readonly secrets: SecretResolver;
}

/**
 * Returns a {@link ChatService} when chat is enabled and (for providers
 * that need one) the credential resolves; returns `null` when:
 *
 *   - `config` is null/undefined (no chat block — kept for callers
 *     that pass `null` directly, e.g. tests),
 *   - `config.enabled` is `false` (explicit opt-out via
 *     `chat: { enabled: false }`),
 *   - the configured `provider` isn't recognized, OR
 *   - the token ref does not resolve (credential-requiring providers).
 *
 * The token-unresolved branch is the wizard's bootstrap path: a
 * fresh install boots with the default `chat.tokenRef:
 * env:OPENROUTER_API_KEY` but the env unset; the `/settings` page
 * writes the key via POST /setup/env, the runtime restarts and picks up
 * the token on the second boot. Until then the agent send routes return
 * `503 chat_disabled`. The local `ollama` provider needs no credential,
 * so it lights up as soon as it's selected.
 */
export async function buildChatService(
	deps: BuildChatServiceDeps,
): Promise<ChatService | null> {
	if (!deps.config) return null;
	if (deps.config.enabled === false) {
		logger.info(
			"chat disabled via `chat.enabled: false` — agent send routes will return 503 chat_disabled",
		);
		return null;
	}

	const resolved = resolveChatProvider({
		provider: deps.config.provider,
		baseUrl: deps.config.baseUrl,
		allowDataCollection: deps.config.allowDataCollection,
	});
	if (!resolved) {
		logger.warn(
			{ provider: deps.config.provider },
			"chat.provider is not a recognized OpenAI-compatible provider (openrouter | openai | ollama); chat will report 503 chat_disabled",
		);
		return null;
	}

	let apiKey = "";
	if (resolved.profile.requiresCredential) {
		try {
			apiKey = await deps.secrets.resolve(deps.config.tokenRef);
		} catch (err) {
			logger.warn(
				{
					ref: deps.config.tokenRef,
					provider: resolved.profile.id,
					err: err instanceof Error ? err.message : String(err),
				},
				"chat token ref did not resolve; chat will report 503 chat_disabled until the secret is set and the runtime restarts",
			);
			return null;
		}
	}

	return new OpenAIChatService({
		apiKey,
		modelId: deps.config.model,
		maxOutputTokens: deps.config.maxOutputTokens,
		baseUrl: resolved.baseUrl,
		providerId: resolved.profile.id,
		defaultHeaders: resolved.defaultHeaders,
		extraBody: resolved.extraBody,
		requestTimeoutMs: deps.config.requestTimeoutMs,
	});
}
