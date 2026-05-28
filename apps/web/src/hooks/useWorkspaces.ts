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
	CreateWorkspaceInput,
	TestConnectionResult,
	UpdateWorkspaceInput,
	Workspace,
} from "@/lib/schemas";

export function useWorkspaces(): UseQueryResult<Workspace[], Error> {
	return useQuery({
		queryKey: keys.workspaces.all,
		queryFn: api.listWorkspaces,
	});
}

export function useWorkspace(
	workspaceId: string | undefined,
): UseQueryResult<Workspace, Error> {
	return useQuery({
		queryKey: workspaceId
			? keys.workspaces.detail(workspaceId)
			: keys.workspaces.all,
		queryFn: () => api.getWorkspace(workspaceId as string),
		enabled: Boolean(workspaceId),
	});
}

export function useCreateWorkspace(): UseMutationResult<
	Workspace,
	Error,
	CreateWorkspaceInput
> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: api.createWorkspace,
		onSuccess: (ws) => {
			qc.invalidateQueries({ queryKey: keys.workspaces.all });
			qc.setQueryData(keys.workspaces.detail(ws.workspaceId), ws);
		},
	});
}

export function useUpdateWorkspace(
	workspaceId: string,
): UseMutationResult<Workspace, Error, UpdateWorkspaceInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateWorkspaceInput) =>
			api.updateWorkspace(workspaceId, patch),
		onSuccess: (ws) => {
			qc.setQueryData(keys.workspaces.detail(workspaceId), ws);
			qc.invalidateQueries({ queryKey: keys.workspaces.all });
			// Flipping `rlacEnabled` can side-effect into principals
			// (bootstrap default `admin` if none) and rag-documents
			// (backfill `visibleTo: ["*"]` on null rows). Invalidate every
			// workspace-scoped query so the affected panels — View-as
			// picker, principals list, document table — refetch through
			// the new state. Cheap: react-query refcounts the subscribers
			// and only refetches what's actually mounted.
			qc.invalidateQueries({ queryKey: keys.workspaces.detail(workspaceId) });
		},
	});
}

export function useDeleteWorkspace(): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: api.deleteWorkspace,
		onSuccess: (_data, workspaceId) => {
			qc.removeQueries({ queryKey: keys.workspaces.detail(workspaceId) });
			qc.invalidateQueries({ queryKey: keys.workspaces.all });
		},
	});
}

export function useTestConnection(
	workspaceId: string,
): UseMutationResult<TestConnectionResult, Error, void> {
	return useMutation({
		mutationFn: () => api.testConnection(workspaceId),
	});
}
