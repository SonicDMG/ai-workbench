import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { api, type PlaygroundSearchInput } from "@/lib/api";
import type { SearchHit } from "@/lib/schemas";

export interface PlaygroundSearchArgs {
	readonly workspace: string;
	readonly knowledgeBase: string;
	readonly input: PlaygroundSearchInput;
}

export function usePlaygroundSearch(): UseMutationResult<
	SearchHit[],
	Error,
	PlaygroundSearchArgs
> {
	return useMutation({
		mutationFn: ({ workspace, knowledgeBase, input }) =>
			api.kbSearch(workspace, knowledgeBase, input),
	});
}
