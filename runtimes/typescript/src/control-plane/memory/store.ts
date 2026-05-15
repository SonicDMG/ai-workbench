/**
 * In-memory {@link ../store.ControlPlaneStore}.
 *
 * Default backend for CI and `docker run` with no external dependencies.
 * Not durable — state is lost when the process exits.
 *
 * Internal layout mirrors the CQL partition structure:
 *   workspaces          : Map<workspaceId, WorkspaceRecord>
 *   knowledgeBases      : Map<workspaceId, Map<kbId, KnowledgeBaseRecord>>
 *   ragDocuments        : Map<`${workspaceId}:${kbId}`, Map<docId, RagDocumentRecord>>
 *   apiKeys             : Map<workspaceId, Map<keyId, ApiKeyRecord>>
 *
 * The store itself is a thin shell — each aggregate's methods live in
 * a sibling file (`workspaces.ts`, `knowledge-bases.ts`, …) and is
 * composed in by the constructor. Every slice closes over a single
 * shared {@link MemoryStoreState} object so cross-aggregate cascades
 * (e.g. `deleteWorkspace`) can reach into every partition without
 * adding cross-slice plumbing.
 *
 * This split is the per-aggregate impl follow-through to ADR-0002 for
 * the memory backend; file/astra are deliberately deferred.
 */

import type { ControlPlaneStore } from "../store.js";
import { makeAgentMethods } from "./agents.js";
import { MemoryApiKeyRepository } from "./api-key-repository.js";
import { makeApiKeyMethods } from "./api-keys.js";
import { makeChatMessageMethods } from "./chat-messages.js";
import { makeChunkingServiceMethods } from "./chunking-services.js";
import { makeConversationMethods } from "./conversations.js";
import { makeEmbeddingServiceMethods } from "./embedding-services.js";
import { makeKnowledgeBaseMethods } from "./knowledge-bases.js";
import { makeKnowledgeFilterMethods } from "./knowledge-filters.js";
import { makeLlmServiceMethods } from "./llm-services.js";
import { makePolicyAuditMethods } from "./policy-audit.js";
import { makePrincipalMethods } from "./principals.js";
import { makeRagDocumentMethods } from "./rag-documents.js";
import { makeRerankingServiceMethods } from "./reranking-services.js";
import { assertWorkspace, type MemoryStoreState } from "./state.js";
import { makeWorkspaceMethods } from "./workspaces.js";

// Build a `MemoryStoreState` populated with empty Maps and a fresh
// {@link MemoryApiKeyRepository}. The repository's workspace check
// closes over the very state object that owns it, so the API-key
// surface participates in the same workspace-existence semantics as
// every other aggregate.
function createState(): MemoryStoreState {
	const state: {
		-readonly [K in keyof MemoryStoreState]: MemoryStoreState[K];
	} = {
		workspaces: new Map(),
		ragDocuments: new Map(),
		// `apiKeyRepo` is set below — it needs `state` to exist first so
		// `assertWorkspace` can close over it.
		apiKeyRepo: null as unknown as MemoryApiKeyRepository,
		knowledgeBases: new Map(),
		knowledgeFilters: new Map(),
		chunkingServices: new Map(),
		embeddingServices: new Map(),
		rerankingServices: new Map(),
		llmServices: new Map(),
		agents: new Map(),
		conversations: new Map(),
		messages: new Map(),
		principals: new Map(),
		policyAudit: new Map(),
	};
	state.apiKeyRepo = new MemoryApiKeyRepository((w) =>
		assertWorkspace(state, w),
	);
	return state;
}

/**
 * Compose every per-aggregate slice into one object satisfying the
 * full {@link ControlPlaneStore} contract.
 */
function buildMemoryStore(): ControlPlaneStore {
	const state = createState();
	return {
		...makeWorkspaceMethods(state),
		...makeApiKeyMethods(state),
		...makeRagDocumentMethods(state),
		...makeKnowledgeBaseMethods(state),
		...makeKnowledgeFilterMethods(state),
		...makeChunkingServiceMethods(state),
		...makeEmbeddingServiceMethods(state),
		...makeRerankingServiceMethods(state),
		...makeLlmServiceMethods(state),
		...makeAgentMethods(state),
		...makeConversationMethods(state),
		...makeChatMessageMethods(state),
		...makePrincipalMethods(state),
		...makePolicyAuditMethods(state),
	};
}

/**
 * Public class shape. Tests, route handlers, and services import
 * `MemoryControlPlaneStore` directly and instantiate it as
 * `new MemoryControlPlaneStore()`; the constructor returns a
 * fully-composed in-memory store. Methods are forwarded to the
 * per-aggregate slice the constructor wired up.
 *
 * The class/interface declaration-merging is intentional: each
 * `Object.assign` line in the constructor is type-checked against the
 * matching `Repo` return type of the corresponding `make*Methods`
 * factory, and the union of those factories produces exactly the
 * {@link ControlPlaneStore} surface declared on the merged interface
 * below. The "unsafe" failure mode the biome rule warns about — a
 * method declared on the interface but not initialized on the class —
 * is impossible here because the constructor's `buildMemoryStore`
 * call must satisfy `ControlPlaneStore` itself, so the type system
 * already enforces that every method is present on `this`.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: methods are populated via Object.assign and the merge is type-checked against ControlPlaneStore
export class MemoryControlPlaneStore implements ControlPlaneStore {
	constructor() {
		Object.assign(this, buildMemoryStore());
	}
}

// Forwarded methods are written by the constructor — declare the
// {@link ControlPlaneStore} surface on the instance so consumers see
// the full method set.
export interface MemoryControlPlaneStore extends ControlPlaneStore {}
