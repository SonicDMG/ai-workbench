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
	uid: string | undefined,
): UseQueryResult<Workspace, Error> {
	return useQuery({
		queryKey: uid ? keys.workspaces.detail(uid) : keys.workspaces.all,
		queryFn: () => api.getWorkspace(uid as string),
		enabled: Boolean(uid),
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
			qc.setQueryData(keys.workspaces.detail(ws.uid), ws);
		},
	});
}

export function useUpdateWorkspace(
	uid: string,
): UseMutationResult<Workspace, Error, UpdateWorkspaceInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateWorkspaceInput) =>
			api.updateWorkspace(uid, patch),
		onSuccess: (ws) => {
			qc.setQueryData(keys.workspaces.detail(uid), ws);
			qc.invalidateQueries({ queryKey: keys.workspaces.all });
		},
	});
}

export function useDeleteWorkspace(): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: api.deleteWorkspace,
		onSuccess: (_data, uid) => {
			qc.removeQueries({ queryKey: keys.workspaces.detail(uid) });
			qc.invalidateQueries({ queryKey: keys.workspaces.all });
		},
	});
}

export function useTestConnection(
	uid: string,
): UseMutationResult<TestConnectionResult, Error, void> {
	return useMutation({
		mutationFn: () => api.testConnection(uid),
	});
}
