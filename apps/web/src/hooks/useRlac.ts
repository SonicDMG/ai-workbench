import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { keys } from "@/lib/query";
import type {
	CreatePrincipalInput,
	PolicyAuditEntry,
	Principal,
} from "@/lib/schemas";

/**
 * React-query hooks for the RLAC admin surface (0.5.0 P4): the
 * workspace's principals registry and the policy-audit log. Mirrors the
 * MCP-servers hook shape — a list query plus mutations that invalidate
 * the list on success.
 */

export function usePrincipals(
	workspaceId: string | undefined,
	enabled = true,
): UseQueryResult<Principal[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys.principals.all(workspaceId)
			: ["principals", "disabled"],
		queryFn: () => api.listPrincipals(workspaceId as string),
		enabled: Boolean(workspaceId) && enabled,
	});
}

export function useCreatePrincipal(
	workspaceId: string,
): UseMutationResult<Principal, Error, CreatePrincipalInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createPrincipal(workspaceId, input),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: keys.principals.all(workspaceId) }),
	});
}

export function useDeletePrincipal(
	workspaceId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (principalId) => api.deletePrincipal(workspaceId, principalId),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: keys.principals.all(workspaceId) }),
	});
}

export function usePolicyAudit(
	workspaceId: string | undefined,
	enabled = true,
): UseQueryResult<PolicyAuditEntry[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys.policyAudit.all(workspaceId)
			: ["policy-audit", "disabled"],
		queryFn: () => api.listPolicyAudit(workspaceId as string),
		enabled: Boolean(workspaceId) && enabled,
	});
}
