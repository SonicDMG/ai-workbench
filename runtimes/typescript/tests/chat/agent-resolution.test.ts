/**
 * Per-turn resolution rules in `agent-resolution.ts`. The bulk of
 * the resolution logic (chat-service selection, KB scope, retrieval
 * K) is exercised through the dispatcher tests; this file pins the
 * legacy-bridge behavior:
 *
 *   - Agents with `ragEnabled: true` and a system prompt that
 *     doesn't mention `search_kb` get `DEFAULT_AGENT_TOOL_GUIDANCE`
 *     prepended at dispatch time, so they keep producing
 *     tool-grounded answers after PR #165 ripped the implicit
 *     `retrieveContextIfEnabled` path.
 *   - Agents whose prompts already cite `search_kb` are left alone
 *     (Bobby/Heidi, plus any user prompt that's already
 *     tool-aware) — the bridge is idempotent.
 *   - Agents with `ragEnabled: false` are never augmented.
 *
 * The bridge goes away when the `ragEnabled` column is dropped in
 * the next release; until then it keeps existing in-the-wild rows
 * answering reliably without a one-shot DB rewrite.
 */

import { describe, expect, test } from "vitest";
import { resolveAgentChat } from "../../src/chat/agent-resolution.js";
import type {
	ChatCompletion,
	ChatService,
	ChatStreamEvent,
} from "../../src/chat/types.js";
import { DEFAULT_AGENT_TOOL_GUIDANCE } from "../../src/control-plane/defaults.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import type {
	AgentRecord,
	ConversationRecord,
} from "../../src/control-plane/types.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { logger } from "../../src/lib/logger.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

class StubChatService implements ChatService {
	readonly modelId = "stub";
	async complete(): Promise<ChatCompletion> {
		throw new Error("not used");
	}
	// biome-ignore lint/correctness/useYield: stub never iterates.
	async *completeStream(): AsyncIterable<ChatStreamEvent> {
		throw new Error("not used");
	}
}

async function fixture(): Promise<{
	deps: Parameters<typeof resolveAgentChat>[0];
	conversation: ConversationRecord;
	workspaceId: string;
}> {
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const embedders = makeFakeEmbedderFactory();
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });

	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	// `createAgent` is needed only to mint a real conversation; the
	// agent the resolution tests pass into ctx is hand-crafted so we
	// can flip `ragEnabled` directly (the public input no longer
	// accepts the field).
	const agent = await store.createAgent(ws.uid, { name: "seed" });
	const conversation = await store.createConversation(ws.uid, agent.agentId, {
		title: "t",
	});

	return {
		deps: {
			store,
			drivers,
			embedders,
			secrets,
			logger,
			chatService: new StubChatService(),
			chatConfig: null,
		},
		conversation,
		workspaceId: ws.uid,
	};
}

function legacyAgent(overrides: Partial<AgentRecord>): AgentRecord {
	return {
		workspaceId: "00000000-0000-0000-0000-000000000000",
		agentId: "00000000-0000-0000-0000-000000000001",
		name: "legacy",
		description: null,
		systemPrompt: null,
		userPrompt: null,
		toolIds: [],
		llmServiceId: null,
		ragEnabled: false,
		knowledgeBaseIds: [],
		ragMaxResults: null,
		ragMinScore: null,
		rerankEnabled: false,
		rerankingServiceId: null,
		rerankMaxResults: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("resolveAgentChat — legacy ragEnabled bridge", () => {
	test("ragEnabled:true + tool-naive prompt → guidance prepended", async () => {
		const f = await fixture();
		const agent = legacyAgent({
			ragEnabled: true,
			systemPrompt: "You are an enterprise assistant. Be concise.",
		});
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent,
			conversation: f.conversation,
		});
		expect(resolved.systemPrompt.startsWith(DEFAULT_AGENT_TOOL_GUIDANCE)).toBe(
			true,
		);
		expect(resolved.systemPrompt).toContain("enterprise assistant");
	});

	test("ragEnabled:true + prompt already mentions search_kb → unchanged", async () => {
		const f = await fixture();
		const promptThatCitesSearchKb =
			"Be helpful. When relevant, call `search_kb` to ground answers.";
		const agent = legacyAgent({
			ragEnabled: true,
			systemPrompt: promptThatCitesSearchKb,
		});
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent,
			conversation: f.conversation,
		});
		expect(resolved.systemPrompt).toBe(promptThatCitesSearchKb);
	});

	test("ragEnabled:false → never augmented (regardless of prompt)", async () => {
		const f = await fixture();
		const agent = legacyAgent({
			ragEnabled: false,
			systemPrompt: "Custom prompt with no tool hints.",
		});
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent,
			conversation: f.conversation,
		});
		expect(resolved.systemPrompt).toBe("Custom prompt with no tool hints.");
	});

	test("ragEnabled:true + null systemPrompt → guidance prepended onto generic default", async () => {
		const f = await fixture();
		const agent = legacyAgent({
			ragEnabled: true,
			systemPrompt: null,
		});
		const resolved = await resolveAgentChat(f.deps, {
			workspaceId: f.workspaceId,
			agent,
			conversation: f.conversation,
		});
		expect(resolved.systemPrompt.startsWith(DEFAULT_AGENT_TOOL_GUIDANCE)).toBe(
			true,
		);
	});
});
