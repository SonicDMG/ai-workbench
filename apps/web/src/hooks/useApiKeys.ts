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
	all: (workspace: string) => ["workspaces", workspace, "api-keys"] as const,
};

export function useApiKeys(
	workspace: string,
): UseQueryResult<ApiKeyRecord[], Error> {
	return useQuery({
		queryKey: keys.all(workspace),
		queryFn: () => api.listApiKeys(workspace),
	});
}

export function useCreateApiKey(
	workspace: string,
): UseMutationResult<CreatedApiKeyResponse, Error, CreateApiKeyInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createApiKey(workspace, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspace) });
		},
	});
}

export function useRevokeApiKey(
	workspace: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (keyId) => api.revokeApiKey(workspace, keyId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspace) });
		},
	});
}
