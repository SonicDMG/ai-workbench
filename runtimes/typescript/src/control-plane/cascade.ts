/**
 * Cascade-delete contract — the **single source of truth** for which
 * dependent resources a {@link ControlPlaneStore} must remove when its
 * parent is deleted, and in which order.
 *
 * Every backend (memory, file, astra; sqlite reuses the file slices)
 * iterates these constants verbatim. The contract test at
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

/**
 * Workspace-owned dependents removed by `deleteWorkspace`, in order.
 *
 * The trailing three (`mcpServers`, `principals`, `policyAudit`) are
 * leaf partitions with no dependents of their own, so their position is
 * free — they only need to precede the workspace-row removal (which is
 * always last). `policyAudit` is **purged, not retained**: even though
 * audit logs sometimes outlive the audited resource, this one is gated —
 * `listPolicyAudit` / `recordPolicyDecision` both `assertWorkspace`
 * first, so once the workspace row is gone the audit rows are
 * permanently unreadable through the store API. Retaining them would
 * strand inaccessible rows, not preserve a usable trail; the audit panel
 * is a demo affordance, not a compliance store (see the slice docs).
 */
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
	"mcpServers",
	"principals",
	"policyAudit",
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
