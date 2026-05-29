/**
 * SQLite-backed {@link ../store.ControlPlaneStore} for chat-heavy /
 * durable single-node deployments.
 *
 * **Why this exists.** The {@link ../file/store.FileControlPlaneStore}
 * rewrites a whole `<table>.json` on every mutation. Under streaming
 * chat that means each appended token-finalizing message rewrites the
 * entire `messages.json` — O(n) per append, O(n²) over a conversation.
 * This backend keeps the same JSON-on-disk *semantics* but persists to
 * SQLite with row-level INSERT/UPDATE/DELETE (WAL mode), so an append is
 * a single-row write regardless of table size.
 *
 * **How it's built.** Every per-aggregate slice in `../file/*.ts` is
 * written purely against the `FileStoreState` seam (`readAll` /
 * `mutate` + the `assert*` helpers). {@link ./state.createSqliteStoreState}
 * implements that seam on SQLite, so this store composes the *unmodified*
 * file slices over a SQLite-backed state — identical behavior, durable
 * row-level storage, zero logic duplication. The composition list below
 * is intentionally identical to `../file/store.ts` and `../memory/store.ts`.
 *
 * Single-node only, like the file backend: WAL gives crash-safe durable
 * writes and in-process concurrency, but multi-writer/multi-process
 * coordination is the astra backend's job.
 */

import Database from "better-sqlite3";
import { makeAgentMethods } from "../file/agents.js";
import { makeApiKeyMethods } from "../file/api-keys.js";
import { makeChatMessageMethods } from "../file/chat-messages.js";
import { makeChunkingServiceMethods } from "../file/chunking-services.js";
import { makeConversationMethods } from "../file/conversations.js";
import { makeEmbeddingServiceMethods } from "../file/embedding-services.js";
import { makeKnowledgeBaseMethods } from "../file/knowledge-bases.js";
import { makeKnowledgeFilterMethods } from "../file/knowledge-filters.js";
import { makeLlmServiceMethods } from "../file/llm-services.js";
import { makeMcpServerMethods } from "../file/mcp-servers.js";
import { makePolicyAuditMethods } from "../file/policy-audit.js";
import { makePrincipalMethods } from "../file/principals.js";
import { makeRagDocumentMethods } from "../file/rag-documents.js";
import { makeRerankingServiceMethods } from "../file/reranking-services.js";
import { makeWorkspaceMethods } from "../file/workspaces.js";
import type { ControlPlaneStore } from "../store.js";
import { createSqliteStoreState, type SqliteStoreState } from "./state.js";

export interface SqliteControlPlaneOptions {
	/**
	 * Filesystem path to the SQLite database file. WAL sidecar files
	 * (`-wal`, `-shm`) are created alongside it. Pass `":memory:"` for an
	 * ephemeral in-process database (used by the contract suite).
	 */
	readonly path: string;
}

/**
 * Compose every per-aggregate slice into one object satisfying the
 * full {@link ControlPlaneStore} contract. The slice factories are the
 * file backend's — they only consume the `FileStoreState` seam, which
 * our SQLite state implements.
 */
function buildSqliteStore(state: SqliteStoreState): ControlPlaneStore {
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
		...makeMcpServerMethods(state),
		...makePolicyAuditMethods(state),
	};
}

/**
 * Public class shape. Tests, route handlers, and the factory import
 * `SqliteControlPlaneStore` directly and instantiate it as
 * `new SqliteControlPlaneStore({ path })`; the constructor opens the
 * connection, applies pragmas + schema, and wires up the composed
 * store. Methods are forwarded to the per-aggregate slice the
 * constructor assembled.
 *
 * The class/interface declaration-merging mirrors `../file/store.ts` and
 * `../memory/store.ts`: `buildSqliteStore` is type-checked against the
 * full {@link ControlPlaneStore} surface, so every method on the merged
 * interface below is guaranteed populated by the time the constructor
 * returns.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: methods are populated via Object.assign and the merge is type-checked against ControlPlaneStore
export class SqliteControlPlaneStore implements ControlPlaneStore {
	private readonly state: SqliteStoreState;

	constructor(opts: SqliteControlPlaneOptions) {
		this.state = createSqliteStoreState(new Database(opts.path));
		Object.assign(this, buildSqliteStore(this.state));
	}

	/**
	 * Schema + pragmas are applied eagerly in the constructor (so the
	 * store is usable immediately, matching the memory backend), making
	 * this a no-op kept only to satisfy the optional
	 * {@link ControlPlaneStore.init} hook the factory calls.
	 */
	async init(): Promise<void> {
		// Intentionally empty — `createSqliteStoreState` already ran the
		// schema migration and pragmas synchronously at construction.
	}

	/** Release the underlying connection (idempotent). */
	async close(): Promise<void> {
		if (this.state.db.open) this.state.db.close();
	}
}

// Forwarded methods are written by the constructor — declare the
// {@link ControlPlaneStore} surface on the instance so consumers see
// the full method set.
export interface SqliteControlPlaneStore extends ControlPlaneStore {}
