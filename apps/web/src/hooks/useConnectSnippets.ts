import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ConnectSnippetsResponse } from "@/lib/schemas";

/**
 * Fetch the rendered per-framework integration snippets for a
 * workspace. The query is keyed by the scope inputs so flipping the
 * KB picker or the env-var name in the UI re-fetches without
 * thrashing — react-query handles the de-dup.
 *
 * Server already sends a short private Cache-Control; combined with
 * react-query's default staleness window this means a fast tab-switch
 * inside the Connect page renders instantly off the in-memory cache.
 */
export function useConnectSnippets(
	workspaceId: string | undefined,
	opts: {
		readonly knowledgeBaseId?: string | null;
		readonly apiKeyEnvVar?: string;
	} = {},
): UseQueryResult<ConnectSnippetsResponse, Error> {
	const knowledgeBaseId = opts.knowledgeBaseId ?? null;
	const apiKeyEnvVar = opts.apiKeyEnvVar ?? null;
	return useQuery({
		queryKey: workspaceId
			? [
					"workspaces",
					workspaceId,
					"connect",
					"snippets",
					{ knowledgeBaseId, apiKeyEnvVar },
				]
			: ["workspaces", "_", "connect", "snippets"],
		queryFn: () => {
			if (!workspaceId) {
				throw new Error("useConnectSnippets requires a workspaceId");
			}
			return api.getConnectSnippets(workspaceId, {
				knowledgeBaseId: knowledgeBaseId ?? undefined,
				apiKeyEnvVar: apiKeyEnvVar ?? undefined,
			});
		},
		enabled: Boolean(workspaceId),
	});
}
