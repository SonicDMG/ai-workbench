/**
 * Principal aggregate (RLAC prototype).
 *
 * Sub-workspace identities that the policy DSL evaluates against.
 * Resolved on every authenticated request by the principal-resolver
 * middleware. `principalId` is a free-form string — _not_ a UUID —
 * because customers think about identities as OIDC subs, emails, or
 * operator-chosen handles.
 */

import type { PrincipalRecord } from "../types.js";

export interface CreatePrincipalInput {
	readonly principalId: string;
	readonly label?: string | null;
	readonly attributes?: Readonly<Record<string, string>>;
}

export interface UpdatePrincipalInput {
	readonly label?: string | null;
	readonly attributes?: Readonly<Record<string, string>>;
}

export interface PrincipalRepo {
	listPrincipals(workspace: string): Promise<readonly PrincipalRecord[]>;
	getPrincipal(
		workspace: string,
		principalId: string,
	): Promise<PrincipalRecord | null>;
	createPrincipal(
		workspace: string,
		input: CreatePrincipalInput,
	): Promise<PrincipalRecord>;
	updatePrincipal(
		workspace: string,
		principalId: string,
		patch: UpdatePrincipalInput,
	): Promise<PrincipalRecord>;
	deletePrincipal(
		workspace: string,
		principalId: string,
	): Promise<{ deleted: boolean }>;
}
