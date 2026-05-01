/**
 * Backend-agnostic contract for the workbench control plane.
 *
 * Implementations:
 *  - {@link ./memory/store.MemoryControlPlaneStore} — in-process, default.
 *  - {@link ./file/store.FileControlPlaneStore} — JSON on disk, single-node.
 *  - `AstraControlPlaneStore` — Data API Tables via astra-db-ts.
 *
 * The interface is composed from per-aggregate repository interfaces
 * declared under [`./repos`](./repos). Consumers that only touch one
 * aggregate can declare the narrower repo type directly (e.g.
 * `(deps: { store: KnowledgeBaseRepo })`); the full implementations
 * still satisfy the whole `ControlPlaneStore` shape, so callers can
 * also pass the monolithic store wherever a specific repo is wanted.
 *
 * Every method is async to allow any backend to be I/O-bound. Synchronous
 * backends simply resolve immediately.
 *
 * Error contract: methods throw {@link ./errors} classes for predictable
 * conditions (not-found, conflict, unavailable). Other thrown errors are
 * treated as internal errors by the route layer.
 */

import type {
	AgentRepo,
	ApiKeyRepo,
	ChatMessageRepo,
	ChunkingServiceRepo,
	ConversationRepo,
	EmbeddingServiceRepo,
	KnowledgeBaseRepo,
	KnowledgeFilterRepo,
	LlmServiceRepo,
	RagDocumentRepo,
	RerankingServiceRepo,
	WorkspaceRepo,
} from "./repos/index.js";

// Re-exports for back-compat — many existing callers import the input
// types directly from `./store.js`. New code should prefer importing
// from the per-aggregate repo file or `./repos/index.js`.
export type {
	AgentRepo,
	ApiKeyRepo,
	AppendChatMessageInput,
	ChatMessageRepo,
	ChunkingServiceRepo,
	ConversationRepo,
	CreateAgentInput,
	CreateChunkingServiceInput,
	CreateConversationInput,
	CreateEmbeddingServiceInput,
	CreateKnowledgeBaseInput,
	CreateKnowledgeFilterInput,
	CreateLlmServiceInput,
	CreateRagDocumentInput,
	CreateRerankingServiceInput,
	CreateWorkspaceInput,
	EmbeddingServiceRepo,
	KnowledgeBaseRepo,
	KnowledgeFilterRepo,
	LlmServiceRepo,
	PersistApiKeyInput,
	RagDocumentRepo,
	RerankingServiceRepo,
	UpdateAgentInput,
	UpdateChatMessageInput,
	UpdateChunkingServiceInput,
	UpdateConversationInput,
	UpdateEmbeddingServiceInput,
	UpdateKnowledgeBaseInput,
	UpdateKnowledgeFilterInput,
	UpdateLlmServiceInput,
	UpdateRagDocumentInput,
	UpdateRerankingServiceInput,
	UpdateWorkspaceInput,
	WorkspaceRepo,
} from "./repos/index.js";

/**
 * Canonical control-plane interface. All methods MUST behave identically
 * across backends modulo durability — a record written must be visible
 * to subsequent reads on the same store instance.
 *
 * **Conventions applied uniformly across every aggregate.** Per-method
 * JSDoc lives on the per-repo interface; deviations are called out
 * inline there.
 *
 * - **Lookup misses return `null`** for `get*` methods. Mutating
 *   methods (`update*`, `delete*`, `revoke*`) on a missing parent or
 *   target throw {@link ./errors.ControlPlaneNotFoundError} — the
 *   route layer maps that to a `404 *_not_found` envelope.
 * - **Conflicts throw {@link ./errors.ControlPlaneConflictError}**:
 *   re-using an explicit `*Id` that already exists, persisting an
 *   API key whose prefix is already indexed, mutating an immutable
 *   field, etc. The route layer maps that to `409` with either the
 *   default `conflict` code or a specialized one (e.g.
 *   `chunking_service_in_use`) per `IN_USE_CODES`.
 * - **List ordering is deterministic.** Workspace and service rows
 *   sort by `(createdAt, id)` ascending; conversations sort by
 *   `createdAt DESC` (newest-first); chat messages sort by
 *   `messageTs ASC` (oldest-first). Ordering matches Astra's
 *   physical clustering so the wire shape doesn't depend on the
 *   backend.
 * - **Cascade on parent delete.** The exact set + order of dependent
 *   resources removed by each parent delete is enumerated in
 *   [`./cascade.ts`](./cascade.ts) — `WORKSPACE_CASCADE_STEPS`,
 *   `KNOWLEDGE_BASE_CASCADE_STEPS`, `AGENT_CASCADE_STEPS`. The
 *   contract test at
 *   `tests/control-plane/cascade-contract.test.ts` runs every backend
 *   through that list, so adding a new workspace-scoped resource
 *   without wiring it into the cascade fails CI.
 * - **Inputs are immutable shapes.** `Create*Input` and
 *   `Update*Input` are validated by the route layer before reaching
 *   the store; the store may assume well-formed input but MUST still
 *   enforce referential integrity (e.g. an agent's `llmServiceId`
 *   must point at an existing service in the same workspace).
 * - **Mutation returns the post-mutation record.** `update*` and
 *   `appendChat*` methods return the row exactly as a subsequent
 *   `get*` would see it — callers don't need to re-read.
 * - **`update*` patches are partial.** Fields absent from the patch
 *   are left untouched; an explicit `null` clears them. Fields that
 *   are immutable post-create are absent from the `Update*Input`
 *   shape entirely (e.g. workspace `kind`).
 * - **No transactional guarantees across method calls.** Operations
 *   that span multiple records (cascade delete, KB+collection
 *   create) run as best-effort sequences. The route layer is
 *   responsible for any compensating cleanup.
 */
export interface ControlPlaneStore
	extends WorkspaceRepo,
		ApiKeyRepo,
		RagDocumentRepo,
		KnowledgeBaseRepo,
		KnowledgeFilterRepo,
		ChunkingServiceRepo,
		EmbeddingServiceRepo,
		RerankingServiceRepo,
		LlmServiceRepo,
		AgentRepo,
		ConversationRepo,
		ChatMessageRepo {
	/** Optional: run migrations, open connections, etc. Idempotent. */
	init?(): Promise<void>;

	/** Optional: release connections and flush buffers. Idempotent. */
	close?(): Promise<void>;
}
