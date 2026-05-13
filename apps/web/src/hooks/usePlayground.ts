import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
	PlaygroundCommandInput,
	PlaygroundCommandResponse,
} from "@/lib/schemas";

export interface PlaygroundCommandArgs {
	readonly workspace: string;
	readonly input: PlaygroundCommandInput;
}

export function usePlaygroundCommand(): UseMutationResult<
	PlaygroundCommandResponse,
	Error,
	PlaygroundCommandArgs
> {
	return useMutation({
		mutationFn: ({ workspace, input }) =>
			api.executePlaygroundCommand(workspace, input),
	});
}
