/**
 * Shared defaults applied by every backend when constructing records from
 * `Create*Input`. Keeping them in one place guarantees memory/file/astra
 * all produce structurally identical records for identical input.
 */

import { createHash } from "node:crypto";
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

/* ---- Chat (workspace-scoped, agentic-tables-backed) defaults ---- */

/**
 * Built-in name for the singleton chat agent.
 *
 * Backed by `wb_agentic_agents_by_workspace`. Future user-defined
 * agents will live in the same table with their own (random) UUIDs;
 * Bobbie's deterministic UUID (see {@link bobbieAgentId}) keeps the
 * two namespaces from colliding.
 */
export const BOBBIE_AGENT_NAME = "Bobbie";

/**
 * Default system prompt for Bobbie. Persisted on the agent row so a
 * single-source-of-truth prompt is auditable per-workspace; can be
 * overridden by ops via runtime config in a later phase.
 */
export const BOBBIE_SYSTEM_PROMPT =
	"You are Bobbie, an assistant grounded in the user's knowledge bases. " +
	"Use the provided context to answer. When you draw on a context " +
	"passage, cite it inline as `[chunkId]`. If the answer is not in the " +
	"context, say so honestly rather than inventing it.";

/**
 * Deterministic agent_id for the singleton Bobbie agent in a given
 * workspace. Same workspace always yields the same id, so concurrent
 * first-use callers converge on a single row instead of racing to
 * insert duplicates.
 *
 * Implementation: SHA-256 of `bobbie:${workspaceId}` formatted as a
 * UUIDv4-shaped string. Not actually a UUIDv5 (would need SHA-1 +
 * a registered namespace UUID), but UUID-shaped is all the column
 * type requires and the high entropy avoids collision with random
 * UUIDs from user-created agents.
 */
export function bobbieAgentId(workspaceId: string): string {
	const hex = createHash("sha256")
		.update(`bobbie:${workspaceId}`)
		.digest("hex");
	// Force the version nibble to '4' and the variant to '8/9/a/b'
	// so the result satisfies UUIDv4 regexes used in zod schemas.
	const variant = (
		(Number.parseInt(hex.slice(16, 17), 16) & 0x3) |
		0x8
	).toString(16);
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		`4${hex.slice(13, 16)}`,
		`${variant}${hex.slice(17, 20)}`,
		hex.slice(20, 32),
	].join("-");
}

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
