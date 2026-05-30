/**
 * Route-layer policy enforcer.
 *
 * The seam between the auth/principal context and the data plane.
 * Every list/get/search call against a policy-enabled KB calls
 * {@link buildPolicyContext} to:
 *
 *   1. Read the KB's `policyDsl` + `policyEnabled` flags.
 *   2. Parse + compile the predicate against the calling principal.
 *   3. Emit a policy-decision audit record.
 *   4. Return the Data API filter to merge into the store call.
 *
 * On the write path, {@link assertPolicyAllowsMutation} fetches the
 * row first, evaluates the predicate in-memory, and throws
 * {@link PolicyDeniedError} on denial. Mutation never invents new
 * `visible_to` content — that's the responsibility of the ingest /
 * update routes, which read it off the request body or default to
 * `[creator_principal_id]`.
 *
 * The enforcer never touches the Data API directly. Its only outputs
 * are (a) an opaque JSON filter, and (b) audit records. The route
 * handler is still responsible for merging the filter into whatever
 * call it was about to make, which keeps the enforcer testable in
 * isolation.
 *
 * **The fact that this code lives in the workbench, not in the Data
 * API, _is_ the design ask.** If the Data API hosted policy
 * compilation and filter injection server-side, this entire module
 * collapses to a single header on every outgoing request. See
 * `docs/rlac-prototype/data-api-design-ask.md`.
 */

import type { PolicyAuditRepo } from "../control-plane/store.js";
import type {
	KnowledgeBaseRecord,
	PolicyAction,
	PolicyDecision,
	RagDocumentRecord,
} from "../control-plane/types.js";
import {
	compilePolicy,
	type DataApiFilter,
	DEFAULT_POLICY_DSL,
	evaluatePolicy,
	type PredicateNode,
	type PrincipalContext,
	parsePolicy,
} from "./index.js";

export class PolicyDeniedError extends Error {
	readonly reason: string;
	constructor(reason: string) {
		super(`policy denied: ${reason}`);
		this.reason = reason;
		this.name = "PolicyDeniedError";
	}
}

/** A KB's policy resolved into something executable. */
export interface ResolvedPolicy {
	readonly enabled: boolean;
	readonly source: string;
	readonly ast: PredicateNode | null;
}

/**
 * Resolve the effective policy for a KB.
 *
 * Workspace-level master switch wins: when `workspaceRlacEnabled` is
 * false, the per-KB `policyEnabled` / `policyDsl` fields are ignored
 * and no filtering happens, regardless of what's stored on the row.
 * When the workspace switch is on, every KB enforces the canonical
 * visibility-list predicate.
 *
 * The per-KB DSL fields are kept in the schema for backward
 * compatibility — older deployments may have hand-authored DSLs — but
 * the simplified "workspace-master + canonical-per-KB" model means
 * they aren't read anymore. A future re-introduction of per-KB
 * custom policies would parse `kb.policyDsl` here.
 */
export function resolvePolicy(
	_kb: KnowledgeBaseRecord,
	workspaceRlacEnabled: boolean,
): ResolvedPolicy {
	if (!workspaceRlacEnabled) {
		return { enabled: false, source: "", ast: null };
	}
	const ast = parsePolicy(DEFAULT_POLICY_DSL);
	return { enabled: true, source: DEFAULT_POLICY_DSL, ast };
}

/**
 * Decision payload returned to the route handler. `filter` is `null`
 * when policy is disabled or the principal context is missing — in
 * which case the route layer should fall back to the legacy
 * workspace-scoped behavior.
 */
export interface PolicyDecisionPayload {
	readonly enabled: boolean;
	readonly principalId: string | null;
	readonly source: string;
	readonly filter: DataApiFilter | null;
}

export interface BuildPolicyContextInput {
	readonly workspace: string;
	/** Workspace-level RLAC master switch. When false, the enforcer
	 * short-circuits and returns a no-filter decision. */
	readonly workspaceRlacEnabled: boolean;
	readonly knowledgeBase: KnowledgeBaseRecord;
	readonly principal: PrincipalContext | null;
	readonly action: PolicyAction;
	readonly resourceId: string;
	readonly audit?: PolicyAuditRepo;
}

/**
 * Compile the KB's policy against the given principal and emit an
 * audit record. The caller merges {@link PolicyDecisionPayload.filter}
 * into its data-plane call.
 */
export async function buildPolicyContext(
	input: BuildPolicyContextInput,
): Promise<PolicyDecisionPayload> {
	const resolved = resolvePolicy(
		input.knowledgeBase,
		input.workspaceRlacEnabled,
	);
	if (!resolved.enabled || !resolved.ast) {
		await recordAudit(input, "allow", "policy disabled", null);
		return {
			enabled: false,
			principalId: input.principal?.id ?? null,
			source: resolved.source,
			filter: null,
		};
	}
	if (!input.principal) {
		// Policy is enabled but no principal — must deny rather than
		// silently match nothing. The route handler maps this to 401.
		await recordAudit(input, "deny", "no principal context", null);
		throw new PolicyDeniedError(
			`knowledge base '${input.knowledgeBase.knowledgeBaseId}' requires a principal`,
		);
	}
	const filter = compilePolicy(resolved.ast, input.principal);
	const decision: PolicyDecision = "filter";
	await recordAudit(input, decision, "filter injected", filter);
	return {
		enabled: true,
		principalId: input.principal.id,
		source: resolved.source,
		filter,
	};
}

async function recordAudit(
	input: BuildPolicyContextInput,
	decision: PolicyDecision,
	reason: string,
	filter: DataApiFilter | null,
): Promise<void> {
	if (!input.audit) return;
	try {
		await input.audit.recordPolicyDecision(input.workspace, {
			principalId: input.principal?.id ?? null,
			knowledgeBaseId: input.knowledgeBase.knowledgeBaseId,
			resourceId: input.resourceId,
			action: input.action,
			decision,
			reason,
			compiledFilterJson: filter ? JSON.stringify(filter) : null,
		});
	} catch {
		// Audit failure must never block the request. The Astra backend
		// throws "not implemented" for the prototype — swallow and move on.
	}
}

export interface AssertMutationInput {
	readonly workspace: string;
	/** Workspace-level RLAC master switch. */
	readonly workspaceRlacEnabled: boolean;
	readonly knowledgeBase: KnowledgeBaseRecord;
	readonly principal: PrincipalContext | null;
	readonly action: PolicyAction;
	readonly document: RagDocumentRecord;
	readonly audit?: PolicyAuditRepo;
}

/**
 * Write-path check: run the parsed predicate against the row that the
 * caller is about to update or delete. Throws {@link PolicyDeniedError}
 * on denial; otherwise records an audit-allow and returns.
 */
export async function assertPolicyAllowsMutation(
	input: AssertMutationInput,
): Promise<void> {
	const resolved = resolvePolicy(
		input.knowledgeBase,
		input.workspaceRlacEnabled,
	);
	if (!resolved.enabled || !resolved.ast) return;
	if (!input.principal) {
		await recordAudit(
			{ ...input, resourceId: input.document.documentId },
			"deny",
			"no principal context",
			null,
		);
		throw new PolicyDeniedError(
			`knowledge base '${input.knowledgeBase.knowledgeBaseId}' requires a principal`,
		);
	}
	const row: Record<string, unknown> = {
		visible_to: input.document.visibleTo,
		owner_id: input.document.ownerPrincipalId,
		owner_principal_id: input.document.ownerPrincipalId,
		status: input.document.status,
		source_filename: input.document.sourceFilename,
		...input.document.metadata,
	};
	const allowed = evaluatePolicy(resolved.ast, row, input.principal);
	await recordAudit(
		{ ...input, resourceId: input.document.documentId },
		allowed ? "allow" : "deny",
		allowed ? "predicate matched" : "predicate did not match",
		null,
	);
	if (!allowed) {
		throw new PolicyDeniedError(
			`document '${input.document.documentId}' is not visible to principal '${input.principal.id}'`,
		);
	}
}
