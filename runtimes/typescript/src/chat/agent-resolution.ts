/**
 * Per-turn effective-config resolution for the agent dispatcher.
 *
 * Computes the chat service, system prompt, KB scope, and tool surface
 * a single agent turn should use. Pulled out of `agent-dispatch.ts` so
 * the orchestration layer there is just the iteration loop +
 * persistence calls — the resolution rules below are the only place
 * each agent-vs-conversation-vs-runtime override lives.
 *
 * Resolution order (mirrors `dispatchAgentSend`'s contract):
 *   - **System prompt**: `agent.systemPrompt` ?? `chatConfig.systemPrompt`
 *     ?? `DEFAULT_AGENT_SYSTEM_PROMPT`.
 *   - **KB scope**: `conversation.knowledgeBaseIds` if non-empty, else
 *     `agent.knowledgeBaseIds` if non-empty, else `[]` (the retrieval
 *     layer interprets `[]` as "all KBs in the workspace").
 *   - **Chat service**: when `agent.llmServiceId` is set, build a fresh
 *     adapter from the workspace's `LlmServiceRecord`. Otherwise fall
 *     back to `deps.chatService` (the global runtime chat service).
 */

import type { ChatConfig } from "../config/schema.js";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "../control-plane/defaults.js";
import { ControlPlaneNotFoundError } from "../control-plane/errors.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type {
	AgentRecord,
	ConversationRecord,
} from "../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import { ApiError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { SecretResolver } from "../secrets/provider.js";
import { OpenAIChatService } from "./openai.js";
import { resolveChatProvider } from "./providers.js";
import {
	type AgentTool,
	type AgentToolDeps,
	type AgentToolset,
	resolveAgentToolset,
} from "./tools/registry.js";
import type { ChatService } from "./types.js";

export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export interface AgentResolutionDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly secrets: SecretResolver;
	readonly logger: Pick<Logger, "warn" | "debug">;
	/** Global runtime chat service; used when the agent has no `llmServiceId`. */
	readonly chatService: ChatService | null;
	/** Mirrors the runtime config; carries the agent persona default. */
	readonly chatConfig: ChatConfig | null;
}

export interface AgentResolutionContext {
	readonly workspaceId: string;
	readonly agent: AgentRecord;
	readonly conversation: ConversationRecord;
}

export interface ResolvedAgentChat {
	readonly chatService: ChatService;
	readonly systemPrompt: string;
	readonly knowledgeBaseIds: readonly string[];
	/**
	 * Tools advertised to the model on every iteration of the
	 * tool-call loop. Empty when the agent's chat provider doesn't
	 * support function calling — the dispatcher falls back to the
	 * old retrieve-and-answer flow.
	 */
	readonly tools: readonly AgentTool[];
	/**
	 * Allow-list resolver for execution time. The dispatcher resolves
	 * each tool call through this, so a model that names a tool outside
	 * the agent's allow-list can't reach it even though only the
	 * advertised `tools` were offered.
	 */
	readonly toolset: AgentToolset;
	/**
	 * Bound context for tool execution. Built once per turn so each
	 * tool invocation doesn't have to plumb workspace + store + driver
	 * registry on its own.
	 */
	readonly toolDeps: AgentToolDeps;
}

export async function resolveAgentChat(
	deps: AgentResolutionDeps,
	ctx: AgentResolutionContext,
): Promise<ResolvedAgentChat> {
	const { store, secrets, chatService, chatConfig } = deps;
	const { workspaceId, agent, conversation } = ctx;

	const chat = await resolveChatService(store, secrets, workspaceId, agent, {
		fallbackChatService: chatService,
		fallbackMaxOutputTokens: chatConfig?.maxOutputTokens,
		fallbackTokenRef: chatConfig?.tokenRef,
		allowDataCollection: chatConfig?.allowDataCollection,
	});

	// System-prompt resolution: agent override > runtime config override
	// > generic default.
	const systemPrompt =
		agent.systemPrompt ??
		chatConfig?.systemPrompt ??
		DEFAULT_AGENT_SYSTEM_PROMPT;

	// KB-scope resolution: per-conversation > per-agent > workspace-wide
	// (the empty list is what tools see when they default to "all KBs").
	const knowledgeBaseIds =
		conversation.knowledgeBaseIds.length > 0
			? conversation.knowledgeBaseIds
			: agent.knowledgeBaseIds.length > 0
				? agent.knowledgeBaseIds
				: [];

	const toolDeps: AgentToolDeps = {
		workspaceId,
		store,
		drivers: deps.drivers,
		embedders: deps.embedders,
		logger: deps.logger,
	};

	// The agent's `toolIds` allow-list selects which tools are advertised
	// to the model and — via `toolset.resolve` — which a tool call may
	// actually reach. Empty `toolIds` grandfathers in all built-in
	// workspace tools. The OpenAI-compatible adapter forwards `tools[]`
	// and parses `tool_calls` back out; the dispatcher loop only iterates
	// when a completion actually emits tool calls.
	const toolset = resolveAgentToolset(agent.toolIds);

	return {
		chatService: chat,
		systemPrompt,
		knowledgeBaseIds,
		tools: toolset.tools,
		toolset,
		toolDeps,
	};
}

interface ChatServiceResolutionOptions {
	readonly fallbackChatService: ChatService | null;
	readonly fallbackMaxOutputTokens: number | undefined;
	/**
	 * Global runtime chat credential. Per the global-key design, a
	 * per-agent llm service with no `credentialRef` of its own draws on
	 * this so operators configure one key, not one-per-service.
	 */
	readonly fallbackTokenRef: string | undefined;
	/** OpenRouter ZDR routing toggle from the runtime chat config. */
	readonly allowDataCollection: boolean | undefined;
}

async function resolveChatService(
	store: ControlPlaneStore,
	secrets: SecretResolver,
	workspaceId: string,
	agent: AgentRecord,
	opts: ChatServiceResolutionOptions,
): Promise<ChatService> {
	if (!agent.llmServiceId) {
		// Phase B keeps the global-chatService fallback for agents that
		// haven't been migrated to per-agent llm services yet. Phase C
		// retires the global fallback alongside the /chats route.
		if (!opts.fallbackChatService) {
			throw new ApiError(
				"chat_disabled",
				"this runtime has no chat service configured and the agent has no llmServiceId; set `chat:` in workbench.yaml or attach an llm service to the agent",
				503,
			);
		}
		return opts.fallbackChatService;
	}

	const record = await store.getLlmService(workspaceId, agent.llmServiceId);
	if (!record) {
		throw new ControlPlaneNotFoundError("llm service", agent.llmServiceId);
	}

	// Every wired provider is OpenAI-compatible; `resolveChatProvider`
	// returns the base URL + headers + body extras, or null for an
	// unknown provider (e.g. a legacy `huggingface` row left over from
	// before 0.3.0).
	const resolved = resolveChatProvider({
		provider: record.provider,
		baseUrl: record.endpointBaseUrl,
		allowDataCollection: opts.allowDataCollection,
	});
	if (!resolved) {
		throw new ApiError(
			"llm_provider_unsupported",
			`only the 'openrouter', 'openai', and 'ollama' providers are supported in this runtime; agent points at provider '${record.provider}'. Recreate the LLM service against a supported provider (HuggingFace was removed in 0.3.0).`,
			422,
		);
	}

	let apiKey = "";
	if (resolved.profile.requiresCredential) {
		// Per-service credentialRef wins; otherwise fall back to the
		// runtime's single global chat token (the global-key design).
		const ref = record.credentialRef ?? opts.fallbackTokenRef ?? null;
		if (!ref) {
			throw new ApiError(
				"llm_credential_missing",
				`llm service '${record.llmServiceId}' has no credentialRef and the runtime has no global chat token configured; cannot authenticate to ${record.provider}`,
				422,
			);
		}
		apiKey = await secrets.resolve(ref);
	}

	const maxOutputTokens =
		record.maxOutputTokens ??
		opts.fallbackMaxOutputTokens ??
		DEFAULT_MAX_OUTPUT_TOKENS;

	return new OpenAIChatService({
		apiKey,
		modelId: record.modelName,
		maxOutputTokens,
		baseUrl: resolved.baseUrl,
		providerId: resolved.profile.id,
		defaultHeaders: resolved.defaultHeaders,
		extraBody: resolved.extraBody,
	});
}
