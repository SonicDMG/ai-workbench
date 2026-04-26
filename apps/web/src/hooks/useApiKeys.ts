import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
	ApiKeyRecord,
	CreateApiKeyInput,
	CreatedApiKeyResponse,
} from "@/lib/schemas";

const keys = {
	all: (workspaceUid: string) =>
		["workspaces", workspaceUid, "api-keys"] as const,
};

export function useApiKeys(
	workspaceUid: string,
): UseQueryResult<ApiKeyRecord[], Error> {
	return useQuery({
		queryKey: keys.all(workspaceUid),
		queryFn: () => api.listApiKeys(workspaceUid),
	});
}

export function useCreateApiKey(
	workspaceUid: string,
): UseMutationResult<CreatedApiKeyResponse, Error, CreateApiKeyInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createApiKey(workspaceUid, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid) });
		},
	});
}

export function useRevokeApiKey(
	workspaceUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (keyId) => api.revokeApiKey(workspaceUid, keyId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid) });
		},
	});
}
