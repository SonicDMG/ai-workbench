/**
 * Per-turn agent resolution rules: system prompt precedence, KB scope
 * precedence, and the per-agent LLM-service → ChatService construction
 * path (with all of its 4xx / 503 failure modes).
 *
 * The dispatcher integration tests exercise the happy path indirectly;
 * this file zooms in on every branch in `resolveChatService` because
 * those control whether a misconfigured agent surfaces a clean 4xx or a
 * confusing 500.
 */

import { describe, expect, test } from "vitest";
import { resolveAgentChat } from "../../src/chat/agent-resolution.js";
import { OpenAIChatService } from "../../src/chat/openai.js";
import type { ChatService } from "../../src/chat/types.js";
import { DEFAULT_AGENT_SYSTEM_PROMPT_WITH_TOOLS } from "../../src/control-plane/defaults.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { logger } from "../../src/lib/logger.js";
import {
	type SecretProvider,
	SecretResolver,
} from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

const FAKE_GLOBAL_CHAT_SERVICE: ChatService = {
	modelId: "global",
	providerId: "fake",
	async complete() {
		throw new Error("unused");
	},
	// biome-ignore lint/correctness/useYield: stub
	async *completeStream() {
		throw new Error("unused");
	},
};

/** Pass-through provider: returns whatever path it's given. */
class StubSecretsProvider implements SecretProvider {
	async resolve(path: string): Promise<string> {
		return path;
	}
}

async function buildFixture(options?: { chatService?: ChatService | null }) {
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const embedders = makeFakeEmbedderFactory();
	const secrets = new SecretResolver({
		stub: new StubSecretsProvider(),
	});

	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	const baseAgent = await store.createAgent(ws.uid, { name: "a" });
	const conversation = await store.createConversation(
		ws.uid,
		baseAgent.agentId,
		{
			title: "t",
		},
	);

	const chatServiceOverride =
		options?.chatService === undefined
			? FAKE_GLOBAL_CHAT_SERVICE
			: options.chatService;

	const deps = {
		store,
		drivers,
		embedders,
		secrets,
		logger,
		chatService: chatServiceOverride,
		chatConfig: null,
	};
	return { store, deps, workspaceId: ws.uid, agent: baseAgent, conversation };
}

describe("resolveAgentChat — fallback chat service", () => {
	test("returns the global runtime chat service when agent has no llmServiceId", async () => {
		const f = await buildFixture();
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent: f.agent,
			conversation: f.conversation,
		});
		expect(resolved.chatService).toBe(FAKE_GLOBAL_CHAT_SERVICE);
	});

	test("raises 503 chat_disabled when no per-agent service AND no global fallback", async () => {
		const f = await buildFixture({ chatService: null });
		await expect(
			resolveAgentChat(f.deps, {
				workspaceId: f.workspaceId,
				agent: f.agent,
				conversation: f.conversation,
			}),
		).rejects.toMatchObject({
			code: "chat_disabled",
			status: 503,
		});
	});
});

describe("resolveAgentChat — per-agent llm-service binding", () => {
	test("builds an OpenRouter-backed service when the agent points at one", async () => {
		const f = await buildFixture();
		const llm = await f.store.createLlmService(f.workspaceId, {
			name: "or-llm",
			provider: "openrouter",
			modelName: "openai/gpt-4o-mini",
			credentialRef: "stub:openrouter_token",
		});
		const agent = await f.store.updateAgent(f.workspaceId, f.agent.agentId, {
			llmServiceId: llm.llmServiceId,
		});
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent,
			conversation: f.conversation,
		});
		expect(resolved.chatService).toBeInstanceOf(OpenAIChatService);
		expect(resolved.chatService.providerId).toBe("openrouter");
	});

	test("builds an OpenAIChatService when the agent points at one", async () => {
		const f = await buildFixture();
		const llm = await f.store.createLlmService(f.workspaceId, {
			name: "oa",
			provider: "openai",
			modelName: "gpt-4o-mini",
			credentialRef: "stub:openai_token",
		});
		const agent = await f.store.updateAgent(f.workspaceId, f.agent.agentId, {
			llmServiceId: llm.llmServiceId,
		});
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent,
			conversation: f.conversation,
		});
		expect(resolved.chatService).toBeInstanceOf(OpenAIChatService);
		expect(resolved.chatService.providerId).toBe("openai");
	});

	test("builds a local Ollama service with no credentialRef", async () => {
		const f = await buildFixture();
		const llm = await f.store.createLlmService(f.workspaceId, {
			name: "ollama-local",
			provider: "ollama",
			modelName: "llama3.1",
		});
		const agent = await f.store.updateAgent(f.workspaceId, f.agent.agentId, {
			llmServiceId: llm.llmServiceId,
		});
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent,
			conversation: f.conversation,
		});
		expect(resolved.chatService).toBeInstanceOf(OpenAIChatService);
		expect(resolved.chatService.providerId).toBe("ollama");
	});

	test("raises a 404 when the agent points at a missing llm-service id", async () => {
		// `updateAgent` validates the FK, so we have to construct an agent
		// in-memory that bypasses the store's referential check.
		const f = await buildFixture();
		const agentWithDanglingRef = {
			...f.agent,
			llmServiceId: "00000000-0000-4000-8000-deadbeefdead",
		};
		await expect(
			resolveAgentChat(f.deps, {
				workspaceId: f.workspaceId,
				agent: agentWithDanglingRef,
				conversation: f.conversation,
			}),
		).rejects.toMatchObject({
			// ControlPlaneNotFoundError is thrown; route layer maps to 404.
			name: "ControlPlaneNotFoundError",
		});
	});

	test("raises 422 llm_provider_unsupported for an unsupported provider", async () => {
		const f = await buildFixture();
		const llm = await f.store.createLlmService(f.workspaceId, {
			name: "unknown",
			provider: "vertex" as unknown as "openai",
			modelName: "gemini-1.5-flash",
			credentialRef: "stub:vertex_token",
		});
		const agent = await f.store.updateAgent(f.workspaceId, f.agent.agentId, {
			llmServiceId: llm.llmServiceId,
		});
		await expect(
			resolveAgentChat(f.deps, {
				workspaceId: f.workspaceId,
				agent,
				conversation: f.conversation,
			}),
		).rejects.toMatchObject({
			code: "llm_provider_unsupported",
			status: 422,
		});
	});

	test("a legacy huggingface record fails closed with 422, not a 500 (0.3.0 migration)", async () => {
		// HuggingFace was removed in 0.3.0. A pre-existing service row left
		// over from <0.3.0 must surface the actionable provider-unsupported
		// error rather than crashing the send path.
		const f = await buildFixture();
		const llm = await f.store.createLlmService(f.workspaceId, {
			name: "legacy-hf",
			provider: "huggingface" as unknown as "openai",
			modelName: "openai/gpt-oss-20b",
			credentialRef: "stub:hf_token",
		});
		const agent = await f.store.updateAgent(f.workspaceId, f.agent.agentId, {
			llmServiceId: llm.llmServiceId,
		});
		await expect(
			resolveAgentChat(f.deps, {
				workspaceId: f.workspaceId,
				agent,
				conversation: f.conversation,
			}),
		).rejects.toMatchObject({
			code: "llm_provider_unsupported",
			status: 422,
		});
	});

	test("raises 422 llm_credential_missing when credentialRef is null and no global token", async () => {
		const f = await buildFixture();
		const llm = await f.store.createLlmService(f.workspaceId, {
			name: "or-no-cred",
			provider: "openrouter",
			modelName: "openai/gpt-4o-mini",
		});
		const agent = await f.store.updateAgent(f.workspaceId, f.agent.agentId, {
			llmServiceId: llm.llmServiceId,
		});
		await expect(
			resolveAgentChat(f.deps, {
				workspaceId: f.workspaceId,
				agent,
				conversation: f.conversation,
			}),
		).rejects.toMatchObject({
			code: "llm_credential_missing",
			status: 422,
		});
	});
});

describe("resolveAgentChat — system prompt precedence", () => {
	test("uses the per-agent system prompt when set", async () => {
		const f = await buildFixture();
		const agent = await f.store.updateAgent(f.workspaceId, f.agent.agentId, {
			systemPrompt: "agent-level",
		});
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent,
			conversation: f.conversation,
		});
		expect(resolved.systemPrompt).toBe("agent-level");
	});

	test("falls back to the runtime chatConfig.systemPrompt when agent is unset", async () => {
		const f = await buildFixture();
		const deps = {
			...f.deps,
			chatConfig: {
				enabled: true,
				provider: "openrouter" as const,
				tokenRef: "stub:openrouter_token",
				baseUrl: null,
				model: "fixture-model",
				maxOutputTokens: 512,
				retrievalK: 6,
				allowDataCollection: false,
				systemPrompt: "runtime-level",
			},
		};
		const resolved = await resolveAgentChat(deps, {
			workspaceId: f.workspaceId,
			agent: f.agent,
			conversation: f.conversation,
		});
		expect(resolved.systemPrompt).toBe("runtime-level");
	});

	test("falls back to DEFAULT_AGENT_SYSTEM_PROMPT_WITH_TOOLS when neither agent nor runtime set one", async () => {
		const f = await buildFixture();
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent: f.agent,
			conversation: f.conversation,
		});
		expect(resolved.systemPrompt).toBe(DEFAULT_AGENT_SYSTEM_PROMPT_WITH_TOOLS);
	});
});

describe("resolveAgentChat — KB scope precedence", () => {
	test("conversation override wins over agent default", async () => {
		const f = await buildFixture();
		const agent = await f.store.updateAgent(f.workspaceId, f.agent.agentId, {
			knowledgeBaseIds: ["agent-kb-1", "agent-kb-2"],
		});
		const conversation = await f.store.updateConversation(
			f.workspaceId,
			agent.agentId,
			f.conversation.conversationId,
			{
				knowledgeBaseIds: ["conv-kb-1"],
			},
		);
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent,
			conversation,
		});
		expect(resolved.knowledgeBaseIds).toEqual(["conv-kb-1"]);
	});

	test("agent default applies when conversation scope is empty", async () => {
		const f = await buildFixture();
		const agent = await f.store.updateAgent(f.workspaceId, f.agent.agentId, {
			knowledgeBaseIds: ["agent-kb-1"],
		});
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent,
			conversation: f.conversation,
		});
		expect(resolved.knowledgeBaseIds).toEqual(["agent-kb-1"]);
	});

	test("returns empty when neither agent nor conversation specify a scope", async () => {
		const f = await buildFixture();
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent: f.agent,
			conversation: f.conversation,
		});
		expect(resolved.knowledgeBaseIds).toEqual([]);
	});
});

describe("resolveAgentChat — always advertises tools + bound toolDeps", () => {
	test("returns a non-empty tools list with deps wired to this turn's workspace", async () => {
		const f = await buildFixture();
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent: f.agent,
			conversation: f.conversation,
		});
		expect(resolved.tools.length).toBeGreaterThan(0);
		expect(resolved.toolDeps.workspaceId).toBe(f.workspaceId);
		expect(resolved.toolDeps.store).toBe(f.deps.store);
	});
});
