/**
 * Per-turn effective-config resolution for the agent dispatcher.
 *
 * Computes the chat service, system prompt, retrieval K, KB scope, and
 * tool surface a single agent turn should use. Pulled out of
 * `agent-dispatch.ts` so the orchestration layer there is just the
 * iteration loop + persistence calls — the resolution rules below are
 * the only place each agent-vs-conversation-vs-runtime override lives.
 *
 * Resolution order (mirrors `dispatchAgentSend`'s contract):
 *   - **System prompt**: `agent.systemPrompt` ?? `chatConfig.systemPrompt`
 *     ?? `DEFAULT_AGENT_SYSTEM_PROMPT`.
 *   - **KB scope**: `conversation.knowledgeBaseIds` if non-empty, else
 *     `agent.knowledgeBaseIds` if non-empty, else `[]` (the retrieval
 *     layer interprets `[]` as "all KBs in the workspace").
 *   - **Retrieval K**: `agent.ragMaxResults` ?? `chatConfig.retrievalK`
 *     ?? `DEFAULT_RETRIEVAL_K`.
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
import {
	HuggingFaceChatService,
	type HuggingFaceChatServiceOptions,
} from "./huggingface.js";
import { OpenAIChatService, type OpenAIChatServiceOptions } from "./openai.js";
import type { RetrievedChunk } from "./prompt.js";
import { retrieveContext } from "./retrieval.js";
import {
	type AgentTool,
	type AgentToolDeps,
	DEFAULT_AGENT_TOOLS,
} from "./tools/registry.js";
import type { ChatService } from "./types.js";

export const DEFAULT_RETRIEVAL_K = 6;
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export interface AgentResolutionDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly secrets: SecretResolver;
	readonly logger: Pick<Logger, "warn" | "debug">;
	/** Global runtime chat service; used when the agent has no `llmServiceId`. */
	readonly chatService: ChatService | null;
	/** Mirrors the runtime config; controls retrieval / persona defaults. */
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
	readonly retrievalK: number;
	readonly knowledgeBaseIds: readonly string[];
	/**
	 * Tools advertised to the model on every iteration of the
	 * tool-call loop. Empty when the agent's chat provider doesn't
	 * support function calling — the dispatcher falls back to the
	 * old retrieve-and-answer flow.
	 */
	readonly tools: readonly AgentTool[];
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
	});

	// System-prompt resolution: agent override > runtime config override
	// > generic default.
	const systemPrompt =
		agent.systemPrompt ??
		chatConfig?.systemPrompt ??
		DEFAULT_AGENT_SYSTEM_PROMPT;

	const retrievalK =
		agent.ragMaxResults ?? chatConfig?.retrievalK ?? DEFAULT_RETRIEVAL_K;

	// KB-scope resolution: per-conversation > per-agent > workspace-wide
	// (the empty list signals "all KBs" to retrieveContext).
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

	// Tools are always advertised to the resolved chat service. The
	// OpenAI adapter forwards them as the `tools[]` request body field
	// and the model decides whether to call them; the HuggingFace
	// adapter drops the field on the floor (its provider request
	// shape doesn't carry tools today), so HF-backed agents simply
	// answer in plain text. There's no harm in advertising regardless,
	// and the dispatcher loop only iterates when a completion actually
	// emits tool calls.
	const tools = DEFAULT_AGENT_TOOLS;

	return {
		chatService: chat,
		systemPrompt,
		retrievalK,
		knowledgeBaseIds,
		tools,
		toolDeps,
	};
}

/**
 * Conditionally pull RAG context up front. Tool-using agents
 * (`ragEnabled === false`) skip the implicit retrieval and let the
 * model decide when to call `search_kb`; classic RAG agents keep the
 * existing top-K-into-system-prompt behavior.
 */
export async function retrieveContextIfEnabled(
	deps: Pick<AgentResolutionDeps, "store" | "drivers" | "embedders" | "logger">,
	agent: AgentRecord,
	request: {
		readonly workspaceId: string;
		readonly knowledgeBaseIds: readonly string[];
		readonly query: string;
		readonly retrievalK: number;
	},
): Promise<readonly RetrievedChunk[]> {
	if (!agent.ragEnabled) return [];
	return retrieveContext(
		{
			store: deps.store,
			drivers: deps.drivers,
			embedders: deps.embedders,
			logger: deps.logger,
		},
		request,
	);
}

interface ChatServiceResolutionOptions {
	readonly fallbackChatService: ChatService | null;
	readonly fallbackMaxOutputTokens: number | undefined;
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
	if (record.provider !== "huggingface" && record.provider !== "openai") {
		throw new ApiError(
			"llm_provider_unsupported",
			`only the 'huggingface' and 'openai' providers are supported in this runtime today; agent points at provider '${record.provider}'`,
			422,
		);
	}
	if (!record.credentialRef) {
		throw new ApiError(
			"llm_credential_missing",
			`llm service '${record.llmServiceId}' has no credentialRef set; cannot authenticate to ${record.provider}`,
			422,
		);
	}

	const credential = await secrets.resolve(record.credentialRef);
	const maxOutputTokens =
		record.maxOutputTokens ??
		opts.fallbackMaxOutputTokens ??
		DEFAULT_MAX_OUTPUT_TOKENS;

	if (record.provider === "huggingface") {
		const options: HuggingFaceChatServiceOptions = {
			token: credential,
			modelId: record.modelName,
			maxOutputTokens,
		};
		return new HuggingFaceChatService(options);
	}
	const options: OpenAIChatServiceOptions = {
		apiKey: credential,
		modelId: record.modelName,
		maxOutputTokens,
	};
	return new OpenAIChatService(options);
}
