/**
 * Shared defaults applied by every backend when constructing records from
 * `Create*Input`. Keeping them in one place guarantees memory/file/astra
 * all produce structurally identical records for identical input.
 */

import {
	defaultOnNewWorkspaceTemplates,
	templateToCreateAgentInput,
} from "./agent-templates.js";
import type { CreateAgentInput } from "./store.js";
import type {
	AuthType,
	DistanceMetric,
	KnowledgeBaseStatus,
	LexicalConfig,
	ServiceStatus,
} from "./types.js";

// Re-export so existing import sites for DEFAULT_AGENT_TOOL_GUIDANCE
// (this file's prior home for it) keep resolving. The canonical home
// is now the template catalog.
export { DEFAULT_AGENT_TOOL_GUIDANCE } from "./agent-templates.js";

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
	"rather than inventing one.\n\n" +
	"When using tools to answer questions:\n" +
	"1. If you need to search knowledge bases, first call `list_kbs` to discover available knowledge bases\n" +
	"2. Then call `search_kb` with the appropriate knowledge base ID and query\n" +
	"3. After gathering sufficient information (typically 1-2 searches), synthesize your answer\n" +
	"4. Avoid repeatedly calling the same tool - if you have enough context, provide your final answer";

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
/**
 * Derived from the template catalog
 * ([`agent-templates.ts`](./agent-templates.ts)) by filtering on
 * `defaultOnNewWorkspace === true`. Today: Bobby + Maven. The
 * dual-source-of-truth lives in the catalog so the catalog can grow
 * (and offer opt-in personas) without changing what every fresh
 * workspace ships with.
 *
 * Wire effect of POST `/api/v1/workspaces` is unchanged across this
 * refactor — the conformance fixture
 * [`agent-crud-basic.json`](../../../../conformance/fixtures/agent-crud-basic.json)
 * still passes.
 */
export const DEFAULT_WORKSPACE_AGENTS: readonly CreateAgentInput[] =
	Object.freeze(
		defaultOnNewWorkspaceTemplates().map((t) =>
			Object.freeze(templateToCreateAgentInput(t)),
		),
	);

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
