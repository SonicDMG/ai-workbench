/**
 * Provider registry for OpenAI-compatible chat backends.
 *
 * OpenRouter, direct OpenAI, and a local Ollama server all speak the
 * OpenAI `POST /chat/completions` wire protocol, so a single
 * {@link ./openai.OpenAIChatService} serves all three. They differ only
 * in:
 *   - base URL,
 *   - whether a credential is required (Ollama runs locally, unauth'd),
 *   - a few provider-specific request headers / body fields
 *     (OpenRouter wants attribution headers + an optional ZDR routing
 *     hint).
 *
 * This module is the one place those per-provider facts live; the
 * global chat factory and the per-agent resolver both build their
 * adapter through {@link resolveChatProvider} so the knowledge isn't
 * duplicated. HuggingFace was removed in 0.3.0 — every wired provider
 * is OpenAI-compatible now.
 */

export type ChatProviderId = "openrouter" | "openai" | "ollama";

/** Every provider the runtime can dispatch chat to. */
export const CHAT_PROVIDER_IDS = ["openrouter", "openai", "ollama"] as const;

/** Default base URL for a local Ollama server's OpenAI-compatible API. */
export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

/** OpenRouter's OpenAI-compatible base URL. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Direct OpenAI base URL. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface ChatProviderProfile {
	readonly id: ChatProviderId;
	readonly label: string;
	readonly defaultBaseUrl: string;
	/**
	 * Whether a credential must resolve before the adapter is built.
	 * Ollama serves locally with no auth, so a missing key is fine.
	 */
	readonly requiresCredential: boolean;
}

const PROFILES: Record<ChatProviderId, ChatProviderProfile> = {
	openrouter: {
		id: "openrouter",
		label: "OpenRouter",
		defaultBaseUrl: OPENROUTER_BASE_URL,
		requiresCredential: true,
	},
	openai: {
		id: "openai",
		label: "OpenAI",
		defaultBaseUrl: OPENAI_BASE_URL,
		requiresCredential: true,
	},
	ollama: {
		id: "ollama",
		label: "Ollama (local)",
		defaultBaseUrl: OLLAMA_DEFAULT_BASE_URL,
		requiresCredential: false,
	},
};

export function isChatProviderId(value: string): value is ChatProviderId {
	return (CHAT_PROVIDER_IDS as readonly string[]).includes(value);
}

export function chatProviderProfile(
	provider: string,
): ChatProviderProfile | null {
	return isChatProviderId(provider) ? PROFILES[provider] : null;
}

/**
 * OpenRouter attribution headers. OpenRouter uses these to populate the
 * app-leaderboard and per-app analytics; they're optional but
 * recommended. Static — they identify the runtime, not the caller.
 */
export const OPENROUTER_HEADERS: Readonly<Record<string, string>> = {
	"HTTP-Referer": "https://github.com/datastax/ai-workbench",
	"X-Title": "AI Workbench",
};

export interface ResolveChatProviderInput {
	readonly provider: string;
	/** Explicit base-URL override (per-service `endpointBaseUrl` or the
	 * global `chat.baseUrl`). Falls back to the provider default. */
	readonly baseUrl?: string | null;
	/**
	 * When false, omit OpenRouter's `provider.data_collection: "deny"`
	 * routing hint so prompts may flow to non-ZDR upstreams. Defaults to
	 * ZDR-only (deny) for every OpenRouter request.
	 */
	readonly allowDataCollection?: boolean;
}

export interface ResolvedChatProvider {
	readonly profile: ChatProviderProfile;
	readonly baseUrl: string;
	readonly defaultHeaders: Readonly<Record<string, string>> | undefined;
	/** Extra request-body fields merged into every completion call. */
	readonly extraBody: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Resolve a provider id (+ optional base-URL override) into the concrete
 * base URL, headers, and request-body extras the OpenAI-compatible
 * adapter needs. Returns `null` for unknown providers so callers can
 * raise their own typed error.
 */
export function resolveChatProvider(
	input: ResolveChatProviderInput,
): ResolvedChatProvider | null {
	const profile = chatProviderProfile(input.provider);
	if (!profile) return null;
	const baseUrl = input.baseUrl?.trim() || profile.defaultBaseUrl;

	if (profile.id === "openrouter") {
		// ZDR-only by default: tell OpenRouter to route exclusively to
		// upstreams that won't retain prompts. Operators opt out via
		// `allowDataCollection: true`.
		const extraBody =
			input.allowDataCollection === true
				? undefined
				: { provider: { data_collection: "deny" } };
		return {
			profile,
			baseUrl,
			defaultHeaders: OPENROUTER_HEADERS,
			extraBody,
		};
	}

	return { profile, baseUrl, defaultHeaders: undefined, extraBody: undefined };
}
