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
	all: (workspaceId: string) =>
		["workspaces", workspaceId, "api-keys"] as const,
};

export function useApiKeys(
	workspaceId: string,
): UseQueryResult<ApiKeyRecord[], Error> {
	return useQuery({
		queryKey: keys.all(workspaceId),
		queryFn: () => api.listApiKeys(workspaceId),
	});
}

export function useCreateApiKey(
	workspaceId: string,
): UseMutationResult<CreatedApiKeyResponse, Error, CreateApiKeyInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createApiKey(workspaceId, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceId) });
		},
	});
}

export function useRevokeApiKey(
	workspaceId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (keyId) => api.revokeApiKey(workspaceId, keyId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceId) });
		},
	});
}
