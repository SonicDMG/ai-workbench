/**
 * Live chat-model catalog for the model picker.
 *
 * Fetches the selectable chat models for a provider so the UI doesn't
 * carry a hardcoded, drifting list:
 *   - **openrouter**: the public `GET /models` catalog, filtered to
 *     tool-calling-capable models (the agent loop needs native function
 *     calling), with a curated "recommended" subset surfaced first.
 *     OpenRouter's models list needs no API key.
 *   - **ollama**: the local server's OpenAI-compatible `/models` (only
 *     the models actually pulled show up).
 *   - **openai**: listing requires a key, so a small curated static set.
 *
 * Every branch degrades to a static fallback when the upstream is
 * unreachable (offline installs, OpenRouter outage) so the picker is
 * never empty. The outbound call uses {@link safeFetch} and is the
 * one network dependency; tests inject `fetchImpl`.
 */

import { safeFetch } from "../lib/safe-fetch.js";
import { OLLAMA_DEFAULT_BASE_URL, OPENROUTER_BASE_URL } from "./providers.js";

export interface ChatModelInfo {
	readonly id: string;
	readonly name: string;
	/** Whether the model supports native tool calling. `null` = unknown
	 * (e.g. a local Ollama model whose capabilities we can't introspect). */
	readonly supportsTools: boolean | null;
	readonly recommended: boolean;
}

export interface ChatModelList {
	readonly provider: string;
	readonly source: "live" | "fallback";
	readonly models: readonly ChatModelInfo[];
}

/**
 * Curated, opinionated short-list surfaced under a "Recommended" group
 * at the top of the OpenRouter picker (and the offline fallback). Kept
 * to ~10 modern, popular, tool-calling-capable models spanning the
 * major providers so the 300+-model catalog isn't a wall of noise. The
 * full live catalog is still searchable below; this is just the
 * sensible-defaults shelf. One source of truth — both the
 * recommended-set membership and the offline fallback derive from it.
 */
const RECOMMENDED_OPENROUTER_MODELS: readonly { id: string; name: string }[] = [
	{ id: "openai/gpt-5.5", name: "OpenAI: GPT-5.5" },
	{ id: "openai/gpt-5-mini", name: "OpenAI: GPT-5 mini" },
	{ id: "anthropic/claude-opus-4.8", name: "Anthropic: Claude Opus 4.8" },
	{ id: "anthropic/claude-sonnet-4.6", name: "Anthropic: Claude Sonnet 4.6" },
	{ id: "anthropic/claude-haiku-4.5", name: "Anthropic: Claude Haiku 4.5" },
	{ id: "google/gemini-3.5-flash", name: "Google: Gemini 3.5 Flash" },
	{ id: "x-ai/grok-4.3", name: "xAI: Grok 4.3" },
	{ id: "deepseek/deepseek-chat", name: "DeepSeek: DeepSeek Chat" },
	{ id: "meta-llama/llama-4-scout", name: "Meta: Llama 4 Scout" },
	{ id: "qwen/qwen3-max", name: "Qwen: Qwen3 Max" },
];

const RECOMMENDED_OPENROUTER_SET = new Set(
	RECOMMENDED_OPENROUTER_MODELS.map((m) => m.id),
);

function recommendedModel(id: string, name: string): ChatModelInfo {
	return { id, name, supportsTools: true, recommended: true };
}

const FALLBACK_OPENROUTER: readonly ChatModelInfo[] =
	RECOMMENDED_OPENROUTER_MODELS.map((m) => recommendedModel(m.id, m.name));

const FALLBACK_OLLAMA: readonly ChatModelInfo[] = [
	{ id: "llama3.1", name: "llama3.1", supportsTools: null, recommended: true },
	{ id: "qwen2.5", name: "qwen2.5", supportsTools: null, recommended: false },
	{ id: "mistral", name: "mistral", supportsTools: null, recommended: false },
];

/**
 * Direct-OpenAI (BYOK) curated list. OpenAI's `/models` needs the
 * caller's key (which this unauthenticated catalog route doesn't
 * resolve), so we surface a hand-maintained set of current
 * tool-calling chat models instead of an empty/2-item list. The top
 * three are grouped as "Recommended"; anything not listed stays
 * reachable via "Other (custom)" in the form.
 */
const STATIC_OPENAI: readonly ChatModelInfo[] = [
	{ id: "gpt-5.5", name: "GPT-5.5", supportsTools: true, recommended: true },
	{
		id: "gpt-5-mini",
		name: "GPT-5 mini",
		supportsTools: true,
		recommended: true,
	},
	{
		id: "gpt-5-nano",
		name: "GPT-5 nano",
		supportsTools: true,
		recommended: true,
	},
	{
		id: "gpt-5.5-pro",
		name: "GPT-5.5 Pro",
		supportsTools: true,
		recommended: false,
	},
	{ id: "gpt-5.1", name: "GPT-5.1", supportsTools: true, recommended: false },
	{ id: "gpt-5", name: "GPT-5", supportsTools: true, recommended: false },
	{ id: "o4-mini", name: "o4-mini", supportsTools: true, recommended: false },
	{ id: "o3", name: "o3", supportsTools: true, recommended: false },
];

interface OpenRouterModelsResponse {
	readonly data?: readonly {
		readonly id: string;
		readonly name?: string;
		readonly supported_parameters?: readonly string[];
	}[];
}

interface OpenAICompatibleModelsResponse {
	readonly data?: readonly { readonly id: string }[];
}

/** Recommended first, then alphabetical by id. */
function byRecommendedThenId(a: ChatModelInfo, b: ChatModelInfo): number {
	if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
	return a.id.localeCompare(b.id);
}

export interface ListChatModelsOptions {
	readonly provider: string;
	/** Base-URL override (Ollama on another host). */
	readonly baseUrl?: string | null;
	readonly fetchImpl?: typeof fetch;
	readonly signal?: AbortSignal;
}

export async function listChatModels(
	opts: ListChatModelsOptions,
): Promise<ChatModelList> {
	const fetchImpl = opts.fetchImpl ?? safeFetch;
	const provider = opts.provider;

	if (provider === "openrouter") {
		try {
			const res = await fetchImpl(`${OPENROUTER_BASE_URL}/models`, {
				headers: { accept: "application/json" },
				signal: opts.signal,
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = (await res.json()) as OpenRouterModelsResponse;
			const models = (json.data ?? [])
				.filter((m) => m.supported_parameters?.includes("tools"))
				.map(
					(m): ChatModelInfo => ({
						id: m.id,
						name: m.name ?? m.id,
						supportsTools: true,
						recommended: RECOMMENDED_OPENROUTER_SET.has(m.id),
					}),
				)
				.sort(byRecommendedThenId);
			if (models.length === 0)
				return { provider, source: "fallback", models: FALLBACK_OPENROUTER };
			return { provider, source: "live", models };
		} catch {
			return { provider, source: "fallback", models: FALLBACK_OPENROUTER };
		}
	}

	if (provider === "ollama") {
		const base = opts.baseUrl?.trim() || OLLAMA_DEFAULT_BASE_URL;
		try {
			const res = await fetchImpl(`${base}/models`, {
				headers: { accept: "application/json" },
				signal: opts.signal,
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = (await res.json()) as OpenAICompatibleModelsResponse;
			const models = (json.data ?? []).map(
				(m): ChatModelInfo => ({
					id: m.id,
					name: m.id,
					supportsTools: null,
					recommended: false,
				}),
			);
			if (models.length === 0)
				return { provider, source: "fallback", models: FALLBACK_OLLAMA };
			return { provider, source: "live", models };
		} catch {
			return { provider, source: "fallback", models: FALLBACK_OLLAMA };
		}
	}

	if (provider === "openai") {
		// Listing OpenAI models requires a key; surface a curated set.
		return { provider, source: "fallback", models: STATIC_OPENAI };
	}

	return { provider, source: "fallback", models: [] };
}
