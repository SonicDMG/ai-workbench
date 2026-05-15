import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { api } from "@/lib/api";
import type {
	CreatePrincipalInput,
	PolicyAuditRecord,
	PolicyCompilePreviewResponse,
	PrincipalRecord,
	UpdatePrincipalInput,
} from "@/lib/schemas";

/**
 * Shorthand for "is the workspace-level RLAC master switch on?"
 *
 * Used by every UI surface that should appear only when access
 * control is in play (View-as picker, visibility pickers in
 * ingest/edit dialogs, visible-to column in the document table,
 * Principals + Policy-audit panels in settings).
 *
 * Returns `false` while the workspace is loading or absent so the
 * UI fails closed — a moment of "RLAC affordances hidden" during
 * page load is preferable to showing them and then having them
 * disappear once the workspace resolves.
 */
export function useRlacEnabled(workspaceId: string | undefined): boolean {
	const ws = useWorkspace(workspaceId);
	return ws.data?.rlacEnabled ?? false;
}

const keys = {
	principals: (workspaceId: string) =>
		["workspaces", workspaceId, "principals"] as const,
	audit: (workspaceId: string) =>
		["workspaces", workspaceId, "policy-audit"] as const,
	preview: (workspaceId: string, dsl: string, principalId: string | null) =>
		[
			"workspaces",
			workspaceId,
			"policy",
			"compile-preview",
			dsl,
			principalId,
		] as const,
};

export function usePrincipals(
	workspaceId: string | undefined,
): UseQueryResult<PrincipalRecord[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys.principals(workspaceId)
			: ["workspaces", "_", "principals"],
		queryFn: () => (workspaceId ? api.listPrincipals(workspaceId) : []),
		enabled: Boolean(workspaceId),
	});
}

export function useCreatePrincipal(
	workspaceId: string,
): UseMutationResult<PrincipalRecord, Error, CreatePrincipalInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createPrincipal(workspaceId, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.principals(workspaceId) });
		},
	});
}

export function useUpdatePrincipal(
	workspaceId: string,
	principalId: string,
): UseMutationResult<PrincipalRecord, Error, UpdatePrincipalInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch) => api.updatePrincipal(workspaceId, principalId, patch),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.principals(workspaceId) });
		},
	});
}

export function useDeletePrincipal(
	workspaceId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (principalId) => api.deletePrincipal(workspaceId, principalId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.principals(workspaceId) });
		},
	});
}

export function usePolicyCompilePreview(
	workspaceId: string | undefined,
	dsl: string,
	principalId: string | null,
): UseQueryResult<PolicyCompilePreviewResponse, Error> {
	return useQuery({
		queryKey: workspaceId
			? keys.preview(workspaceId, dsl, principalId)
			: ["workspaces", "_", "policy", "compile-preview"],
		queryFn: async () => {
			if (!workspaceId) {
				throw new Error("usePolicyCompilePreview requires workspaceId");
			}
			return api.compilePolicy(workspaceId, {
				dsl,
				principalId: principalId ?? undefined,
			});
		},
		enabled: Boolean(workspaceId) && dsl.trim().length > 0,
		staleTime: 30_000,
	});
}

export function usePolicyAudit(
	workspaceId: string | undefined,
	query: {
		readonly principalId?: string;
		readonly knowledgeBaseId?: string;
		readonly limit?: number;
	} = {},
): UseQueryResult<PolicyAuditRecord[], Error> {
	return useQuery({
		queryKey: workspaceId
			? [...keys.audit(workspaceId), query]
			: ["workspaces", "_", "policy-audit"],
		queryFn: () => (workspaceId ? api.listPolicyAudit(workspaceId, query) : []),
		enabled: Boolean(workspaceId),
		// Audit updates frequently during the demo; short staleTime keeps
		// the panel snappy without thrashing the network.
		staleTime: 2_000,
		refetchInterval: 5_000,
	});
}
