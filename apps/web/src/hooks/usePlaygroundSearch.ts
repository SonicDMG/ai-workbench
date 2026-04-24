import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { api, type PlaygroundSearchInput } from "@/lib/api";
import type { SearchHit } from "@/lib/schemas";

export interface PlaygroundSearchArgs {
	readonly workspace: string;
	readonly vectorStore: string;
	readonly input: PlaygroundSearchInput;
}

export function usePlaygroundSearch(): UseMutationResult<
	SearchHit[],
	Error,
	PlaygroundSearchArgs
> {
	return useMutation({
		mutationFn: ({ workspace, vectorStore, input }) =>
			api.search(workspace, vectorStore, input),
	});
}
