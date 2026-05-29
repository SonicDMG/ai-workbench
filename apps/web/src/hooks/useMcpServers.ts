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
	CreateMcpServerInput,
	McpServerRecord,
	UpdateMcpServerInput,
} from "@/lib/schemas";

/**
 * React-query hooks for the per-workspace external-MCP-server registry
 * (0.4.0 A2 backend; A6 settings UI). Mirrors the principals/RLAC hook
 * shape: a list query plus create/update/delete mutations that
 * invalidate the list on success. Registering a server also widens an
 * agent's selectable tool catalog, so mutations additionally invalidate
 * the `available-tools` query.
 */

export function useMcpServers(
	workspaceId: string | undefined,
): UseQueryResult<McpServerRecord[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys.mcpServers.all(workspaceId)
			: ["mcp-servers", "disabled"],
		queryFn: () => api.listMcpServers(workspaceId as string),
		enabled: Boolean(workspaceId),
	});
}

/** Invalidate both the server list and the dependent tool catalog. */
function invalidateMcpAndTools(
	qc: ReturnType<typeof useQueryClient>,
	workspaceId: string,
): void {
	qc.invalidateQueries({ queryKey: keys.mcpServers.all(workspaceId) });
	qc.invalidateQueries({ queryKey: keys.availableTools.all(workspaceId) });
}

export function useCreateMcpServer(
	workspaceId: string,
): UseMutationResult<McpServerRecord, Error, CreateMcpServerInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createMcpServer(workspaceId, input),
		onSuccess: () => invalidateMcpAndTools(qc, workspaceId),
	});
}

export function useUpdateMcpServer(
	workspaceId: string,
	mcpServerId: string,
): UseMutationResult<McpServerRecord, Error, UpdateMcpServerInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch) => api.updateMcpServer(workspaceId, mcpServerId, patch),
		onSuccess: () => invalidateMcpAndTools(qc, workspaceId),
	});
}

export function useDeleteMcpServer(
	workspaceId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (mcpServerId) => api.deleteMcpServer(workspaceId, mcpServerId),
		onSuccess: () => invalidateMcpAndTools(qc, workspaceId),
	});
}
