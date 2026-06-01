/**
 * RLAC enforcement helpers for the agent retrieval surface.
 *
 * Agent tools and the MCP `run_agent` RAG path read the same documents
 * and chunks the REST routes do, so they must honor the same row-level
 * access policy — otherwise an agent becomes a confused-deputy that
 * retrieves documents its caller can't see. These helpers compile the
 * caller's policy filter for a KB and fold it into the search / list
 * filter the data plane runs; chunks carry `visible_to` (stamped at
 * ingest), so the filter pushes down and invisible chunks never come
 * back.
 *
 * Fail-soft for the agent surface: a policy-enabled workspace with no
 * resolvable principal yields an empty result (nothing leaks) rather
 * than a hard error mid-conversation — the per-KB retrieval loop already
 * skips KBs it can't read.
 */

import type { ResolvedPrincipal } from "../../auth/types.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type {
	KnowledgeBaseRecord,
	PolicyAction,
	RagDocumentRecord,
	WorkspaceRecord,
} from "../../control-plane/types.js";
import {
	applyDataApiFilterInMemory,
	type DataApiFilter,
} from "../../lib/data-api-filter.js";
import {
	buildPolicyContext,
	PolicyDeniedError,
} from "../../policy/enforcer.js";

export interface KbReadPolicy {
	/** False when policy is enabled but no principal resolved — the caller
	 * skips the KB / returns an empty result so nothing leaks. */
	readonly allow: boolean;
	/** Compiled Data API filter to fold into the read, or null = no
	 * constraint (RLAC off, or an admin principal whose policy collapses
	 * to match-all). */
	readonly filter: DataApiFilter | null;
}

export interface ResolveKbReadPolicyArgs {
	readonly store: ControlPlaneStore;
	readonly workspace: WorkspaceRecord;
	readonly knowledgeBase: KnowledgeBaseRecord;
	/** Caller's principal. `undefined` is treated as `null` (no principal),
	 * so callers can pass an optional deps field straight through. */
	readonly principal: ResolvedPrincipal | null | undefined;
	readonly action: PolicyAction;
	readonly resourceId: string;
}

/**
 * Compile the caller's read policy for a KB. Wraps the route-layer
 * enforcer ({@link buildPolicyContext}), which also writes the audit
 * record, and translates a `PolicyDeniedError` (policy on + no principal)
 * into `{ allow: false }` so agent callers can fail soft.
 */
export async function resolveKbReadPolicy(
	args: ResolveKbReadPolicyArgs,
): Promise<KbReadPolicy> {
	try {
		const decision = await buildPolicyContext({
			workspace: args.workspace.uid,
			workspaceRlacEnabled: args.workspace.rlacEnabled,
			knowledgeBase: args.knowledgeBase,
			principal: args.principal ?? null,
			action: args.action,
			resourceId: args.resourceId,
			audit: args.store,
		});
		return { allow: true, filter: decision.filter };
	} catch (err) {
		if (err instanceof PolicyDeniedError) return { allow: false, filter: null };
		throw err;
	}
}

/**
 * Fold the compiled policy filter into a caller-supplied Data API filter
 * with `$and`. Either side may be empty/absent; a match-all (`{}`) or
 * null policy adds no constraint.
 */
export function mergeReadFilter(
	base: DataApiFilter | undefined,
	policy: DataApiFilter | null,
): DataApiFilter | undefined {
	if (!policy || Object.keys(policy).length === 0) return base;
	if (!base || Object.keys(base).length === 0) return policy;
	return { $and: [base, policy] };
}

/**
 * Filter control-plane rag-document rows by a compiled policy filter,
 * projecting each row's camelCase fields to the snake_case columns the
 * compiler emits (`visible_to`, `owner_principal_id`). A null `visibleTo`
 * (hidden, admin-only) projects to an empty set — invisible to non-admins.
 */
export function filterVisibleDocuments(
	docs: readonly RagDocumentRecord[],
	filter: DataApiFilter | null,
): readonly RagDocumentRecord[] {
	return applyDataApiFilterInMemory(docs, filter, (d) => ({
		visible_to: d.visibleTo ?? [],
		owner_principal_id: d.ownerPrincipalId ?? null,
	}));
}

/**
 * List a KB's documents filtered to those the principal may see — the
 * RLAC-aware replacement for a bare `store.listRagDocuments` in the agent
 * document-enumeration tools (list/count/summarize). Returns `[]` for an
 * unknown KB or a policy-denied read (fail-soft), so enumeration never
 * leaks the existence of documents the caller can't see.
 */
export async function listVisibleDocuments(args: {
	readonly store: ControlPlaneStore;
	readonly workspaceId: string;
	readonly knowledgeBaseId: string;
	readonly principal: ResolvedPrincipal | null | undefined;
}): Promise<readonly RagDocumentRecord[]> {
	const workspace = await args.store.getWorkspace(args.workspaceId);
	if (!workspace) return [];
	const knowledgeBase = await args.store.getKnowledgeBase(
		args.workspaceId,
		args.knowledgeBaseId,
	);
	if (!knowledgeBase) return [];
	const docs = await args.store.listRagDocuments(
		args.workspaceId,
		args.knowledgeBaseId,
	);
	const policy = await resolveKbReadPolicy({
		store: args.store,
		workspace,
		knowledgeBase,
		principal: args.principal,
		action: "list",
		resourceId: "*",
	});
	if (!policy.allow) return [];
	return filterVisibleDocuments(docs, policy.filter);
}
