/**
 * Cascade-delete contract — the **single source of truth** for which
 * dependent resources a {@link ControlPlaneStore} must remove when its
 * parent is deleted, and in which order.
 *
 * Every backend (memory, file, astra) iterates these constants
 * verbatim. The contract test at
 * [`tests/control-plane/cascade-contract.test.ts`](../../tests/control-plane/cascade-contract.test.ts)
 * builds one of every dependent type, deletes the parent, and asserts
 * every dependent named here is gone — keeping the three backends from
 * drifting and catching new resource types that forget cascade wiring.
 *
 * Ordering rule: **children before parents**. A dependent that owns
 * its own dependents (e.g. `knowledgeBases` owns `ragDocuments`,
 * `agents` own `conversations`) is removed *after* its grandchildren.
 * For workspaces, the workspace row itself is removed last.
 */

/** Workspace-owned dependents removed by `deleteWorkspace`, in order. */
export const WORKSPACE_CASCADE_STEPS = [
	"apiKeys",
	"knowledgeFilters",
	"ragDocuments",
	"knowledgeBases",
	"messages",
	"conversations",
	"agents",
	"chunkingServices",
	"embeddingServices",
	"rerankingServices",
	"llmServices",
] as const;

export type WorkspaceCascadeStep = (typeof WORKSPACE_CASCADE_STEPS)[number];

/** Knowledge-base-owned dependents removed by `deleteKnowledgeBase`. */
export const KNOWLEDGE_BASE_CASCADE_STEPS = [
	"knowledgeFilters",
	"ragDocuments",
] as const;

export type KnowledgeBaseCascadeStep =
	(typeof KNOWLEDGE_BASE_CASCADE_STEPS)[number];

/** Agent-owned dependents removed by `deleteAgent`. */
export const AGENT_CASCADE_STEPS = ["messages", "conversations"] as const;

export type AgentCascadeStep = (typeof AGENT_CASCADE_STEPS)[number];
