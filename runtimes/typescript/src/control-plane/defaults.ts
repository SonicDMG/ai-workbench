/**
 * Shared defaults applied by every backend when constructing records from
 * `Create*Input`. Keeping them in one place guarantees memory/file/astra
 * all produce structurally identical records for identical input.
 */

import type {
	AuthType,
	DistanceMetric,
	KnowledgeBaseStatus,
	LexicalConfig,
	RerankingConfig,
	ServiceStatus,
} from "./types.js";

/* ---- Knowledge-Base schema defaults (issue #98) ---- */

export const DEFAULT_DISTANCE_METRIC: DistanceMetric = "cosine";
export const DEFAULT_KB_STATUS: KnowledgeBaseStatus = "active";
export const DEFAULT_SERVICE_STATUS: ServiceStatus = "active";
export const DEFAULT_AUTH_TYPE: AuthType = "none";

/**
 * Build the auto-provisioned Astra collection name for a KB. The KB
 * id (a UUID) maps 1:1 to a single physical collection — naming by id
 * means renaming a KB never touches the data plane.
 *
 * Hyphens are stripped because Astra collection names must match
 * `^[a-zA-Z][a-zA-Z0-9_]*$`.
 */
export function defaultVectorCollection(knowledgeBaseId: string): string {
	return `wb_vectors_${knowledgeBaseId.replace(/-/g, "")}`;
}

export const DEFAULT_LEXICAL: LexicalConfig = Object.freeze({
	enabled: false,
	analyzer: null,
	options: Object.freeze({}) as Readonly<Record<string, string>>,
});

export const DEFAULT_RERANKING: RerankingConfig = Object.freeze({
	enabled: false,
	provider: null,
	model: null,
	endpoint: null,
	secretRef: null,
});

export function nowIso(): string {
	return new Date().toISOString();
}

/* ---- Agent / chat (agentic-tables-backed) defaults ---- */

/**
 * Generic fallback system prompt used by user-defined agents that
 * don't supply their own `systemPrompt`. Picked up by the agent
 * dispatcher only when both `agent.systemPrompt` and
 * `chatConfig.systemPrompt` are null. Deliberately persona-agnostic
 * so the runtime never imposes a hard-coded persona on a user agent.
 */
export const DEFAULT_AGENT_SYSTEM_PROMPT =
	"You are a helpful assistant grounded in the provided knowledge base " +
	"context. When you draw on a context passage, cite it inline as " +
	"`[chunk-uuid]`. If the context does not support an answer, decline " +
	"rather than inventing one.";

/**
 * Comparator that sorts records by `createdAt` ascending, then by `uid`
 * ascending as a tie-breaker (ISO timestamps collide at millisecond
 * resolution when rows are created in the same tick). Produces a
 * total order, which is what callers and fixtures rely on.
 */
export function byCreatedAtThenUid<
	T extends { readonly createdAt: string; readonly uid: string },
>(a: T, b: T): number {
	if (a.createdAt < b.createdAt) return -1;
	if (a.createdAt > b.createdAt) return 1;
	if (a.uid < b.uid) return -1;
	if (a.uid > b.uid) return 1;
	return 0;
}

/**
 * Comparator for records that use `keyId` instead of `uid` for their
 * identity. Same semantics as {@link byCreatedAtThenUid}.
 */
export function byCreatedAtThenKeyId<
	T extends { readonly createdAt: string; readonly keyId: string },
>(a: T, b: T): number {
	if (a.createdAt < b.createdAt) return -1;
	if (a.createdAt > b.createdAt) return 1;
	if (a.keyId < b.keyId) return -1;
	if (a.keyId > b.keyId) return 1;
	return 0;
}
