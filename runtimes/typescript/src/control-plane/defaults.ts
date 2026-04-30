/**
 * Shared defaults applied by every backend when constructing records from
 * `Create*Input`. Keeping them in one place guarantees memory/file/astra
 * all produce structurally identical records for identical input.
 */

import type { CreateAgentInput } from "./store.js";
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
 * Starter agents auto-seeded into every freshly created workspace by the
 * workspace POST handler. The intent is that a new workspace is never
 * empty — the user can chat with one of these immediately, then either
 * customise them, replace them, or delete them entirely. Neither agent
 * carries an `llmServiceId`, so both fall through to the runtime's
 * global `chat:` block until the user wires up a per-workspace LLM
 * service.
 *
 * Seeding lives in the route layer (not the store) so that re-creating
 * a workspace via the store-level contract still produces an empty
 * agent list — only requests that flow through the public API surface
 * pick up these defaults.
 */
export const DEFAULT_WORKSPACE_AGENTS: readonly CreateAgentInput[] =
	Object.freeze([
		Object.freeze({
			name: "Bobby",
			description:
				"A no-nonsense data analyst. Direct, precise, and grounded — " +
				"Bobby gets to the point.",
			systemPrompt:
				"You are Bobby, a professional and firm data assistant. Be " +
				"direct, concise, and precise. When you draw on a context " +
				"passage from the knowledge base, cite it inline as " +
				"`[chunk-uuid]`. If the context does not support an answer, " +
				"say so plainly — do not speculate or hedge. No filler, no " +
				"apologies, no unnecessary preamble.",
		}) as CreateAgentInput,
		Object.freeze({
			name: "Heidi",
			description:
				"A friendly little ghost with a knack for digging up the " +
				"answers that haunt your data. Warm, playful, and curious.",
			systemPrompt:
				"You are Heidi, a cheerful little ghost who loves helping " +
				"users explore their data. You're warm, curious, and a touch " +
				"whimsical — feel free to add a gentle 'boo!' or a wispy " +
				"aside now and then — but you always finish with a clear, " +
				"useful answer. Float through the provided knowledge base " +
				"context to find the most spectral truths, and cite passages " +
				"inline as `[chunk-uuid]`. If the context doesn't support an " +
				"answer, fade away politely rather than inventing one.",
		}) as CreateAgentInput,
	]);

/**
 * Comparator that sorts records by `createdAt` ascending, then by `uid`
 * ascending as a tie-breaker (ISO timestamps collide at millisecond
 * resolution when rows are created in the same tick). Produces a
 * total order, which is what callers and fixtures rely on.
 */
export function byCreatedAtThenId<
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
 * identity. Same semantics as {@link byCreatedAtThenId}.
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
