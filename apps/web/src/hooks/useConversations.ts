import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import { sendConversationStream } from "@/lib/chatStream";
import { keys } from "@/lib/query";
import type {
	AgentRecord,
	ChatMessage,
	ConversationRecord,
	CreateAgentInput,
	CreateConversationInput,
	CreateLlmServiceInput,
	LlmServiceRecord,
	UpdateAgentInput,
	UpdateConversationInput,
	UpdateLlmServiceInput,
} from "@/lib/schemas";

/* -------- Agents -------- */

export function useAgents(
	workspaceId: string | undefined,
): UseQueryResult<AgentRecord[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys.agents.all(workspaceId)
			: ["agents", "disabled"],
		queryFn: () => api.listAgents(workspaceId as string),
		enabled: Boolean(workspaceId),
	});
}

export function useAgent(
	workspaceId: string | undefined,
	agentId: string | undefined,
): UseQueryResult<AgentRecord, Error> {
	return useQuery({
		queryKey:
			workspaceId && agentId
				? keys.agents.detail(workspaceId, agentId)
				: ["agents", "disabled"],
		queryFn: () => api.getAgent(workspaceId as string, agentId as string),
		enabled: Boolean(workspaceId && agentId),
	});
}

export function useCreateAgent(
	workspaceId: string,
): UseMutationResult<AgentRecord, Error, CreateAgentInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateAgentInput) =>
			api.createAgent(workspaceId, input),
		onSuccess: (agent) => {
			qc.invalidateQueries({ queryKey: keys.agents.all(workspaceId) });
			qc.setQueryData(keys.agents.detail(workspaceId, agent.agentId), agent);
		},
	});
}

export function useUpdateAgent(
	workspaceId: string,
	agentId: string,
): UseMutationResult<AgentRecord, Error, UpdateAgentInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateAgentInput) =>
			api.updateAgent(workspaceId, agentId, patch),
		onSuccess: (agent) => {
			qc.setQueryData(keys.agents.detail(workspaceId, agentId), agent);
			qc.invalidateQueries({ queryKey: keys.agents.all(workspaceId) });
		},
	});
}

export function useDeleteAgent(
	workspaceId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (agentId: string) => api.deleteAgent(workspaceId, agentId),
		onSuccess: (_data, agentId) => {
			qc.removeQueries({ queryKey: keys.agents.detail(workspaceId, agentId) });
			qc.removeQueries({
				queryKey: keys.conversations.all(workspaceId, agentId),
			});
			qc.invalidateQueries({ queryKey: keys.agents.all(workspaceId) });
		},
	});
}

/* -------- Conversations -------- */

export function useConversations(
	workspaceId: string | undefined,
	agentId: string | undefined,
): UseQueryResult<ConversationRecord[], Error> {
	return useQuery({
		queryKey:
			workspaceId && agentId
				? keys.conversations.all(workspaceId, agentId)
				: ["conversations", "disabled"],
		queryFn: () =>
			api.listConversations(workspaceId as string, agentId as string),
		enabled: Boolean(workspaceId && agentId),
	});
}

export function useConversation(
	workspaceId: string | undefined,
	agentId: string | undefined,
	conversationId: string | undefined,
): UseQueryResult<ConversationRecord, Error> {
	return useQuery({
		queryKey:
			workspaceId && agentId && conversationId
				? keys.conversations.detail(workspaceId, agentId, conversationId)
				: ["conversations", "disabled"],
		queryFn: () =>
			api.getConversation(
				workspaceId as string,
				agentId as string,
				conversationId as string,
			),
		enabled: Boolean(workspaceId && agentId && conversationId),
	});
}

export function useCreateConversation(
	workspaceId: string,
	agentId: string,
): UseMutationResult<ConversationRecord, Error, CreateConversationInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateConversationInput) =>
			api.createConversation(workspaceId, agentId, input),
		onSuccess: (conv) => {
			qc.invalidateQueries({
				queryKey: keys.conversations.all(workspaceId, agentId),
			});
			qc.setQueryData(
				keys.conversations.detail(workspaceId, agentId, conv.conversationId),
				conv,
			);
		},
	});
}

export function useUpdateConversation(
	workspaceId: string,
	agentId: string,
	conversationId: string,
): UseMutationResult<ConversationRecord, Error, UpdateConversationInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateConversationInput) =>
			api.updateConversation(workspaceId, agentId, conversationId, patch),
		onSuccess: (conv) => {
			qc.setQueryData(
				keys.conversations.detail(workspaceId, agentId, conversationId),
				conv,
			);
			qc.invalidateQueries({
				queryKey: keys.conversations.all(workspaceId, agentId),
			});
		},
	});
}

export function useDeleteConversation(
	workspaceId: string,
	agentId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (conversationId: string) =>
			api.deleteConversation(workspaceId, agentId, conversationId),
		onSuccess: (_data, conversationId) => {
			qc.removeQueries({
				queryKey: keys.conversations.detail(
					workspaceId,
					agentId,
					conversationId,
				),
			});
			qc.removeQueries({
				queryKey: keys.conversations.messages(
					workspaceId,
					agentId,
					conversationId,
				),
			});
			qc.invalidateQueries({
				queryKey: keys.conversations.all(workspaceId, agentId),
			});
		},
	});
}

export function useConversationMessages(
	workspaceId: string | undefined,
	agentId: string | undefined,
	conversationId: string | undefined,
): UseQueryResult<ChatMessage[], Error> {
	return useQuery({
		queryKey:
			workspaceId && agentId && conversationId
				? keys.conversations.messages(workspaceId, agentId, conversationId)
				: ["conversations", "disabled"],
		queryFn: () =>
			api.listConversationMessages(
				workspaceId as string,
				agentId as string,
				conversationId as string,
			),
		enabled: Boolean(workspaceId && agentId && conversationId),
	});
}

/**
 * Streaming variant. Returns:
 *   - `send(content)` to fire a turn,
 *   - `pendingDelta` accumulating the in-flight token buffer,
 *   - `pending` boolean for the whole turn lifecycle,
 *   - `cancel()` to abort the in-flight stream.
 *
 * The hook drives the cached message list via react-query so the
 * regular `useConversationMessages` hook keeps rendering the canonical
 * view. The `pendingDelta` is a separate piece of UI state for "live"
 * tokens that haven't been persisted yet — once the stream emits
 * `done` / `error`, the cache appends the canonical assistant row and
 * `pendingDelta` is cleared.
 */
export interface SendConversationStreamHandle {
	/**
	 * Open the stream and pump events. Resolves with `null` on success
	 * or the redacted error message string on failure. The returned
	 * value is the source of truth for "did this attempt fail" — do
	 * NOT read `error` from this handle immediately after `await
	 * send(...)`, because React state updates have not flushed yet
	 * (stale closure).
	 */
	readonly send: (content: string) => Promise<string | null>;
	readonly pendingDelta: string;
	readonly pending: boolean;
	readonly error: string | null;
	readonly cancel: () => void;
}

export function useSendConversationStream(
	workspaceId: string,
	agentId: string,
	conversationId: string,
): SendConversationStreamHandle {
	const qc = useQueryClient();
	const [pendingDelta, setPendingDelta] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const cancel = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	const send = useCallback(
		async (content: string): Promise<string | null> => {
			if (pending) return null;
			const ctrl = new AbortController();
			abortRef.current = ctrl;
			setPending(true);
			setPendingDelta("");
			setError(null);
			try {
				let buffer = "";
				await sendConversationStream(workspaceId, agentId, conversationId, {
					content,
					signal: ctrl.signal,
					onEvent: (evt) => {
						if (evt.type === "user-message") {
							qc.setQueryData<ChatMessage[]>(
								keys.conversations.messages(
									workspaceId,
									agentId,
									conversationId,
								),
								(previous) => [...(previous ?? []), evt.message],
							);
						} else if (evt.type === "token") {
							buffer += evt.delta;
							setPendingDelta(buffer);
						} else if (evt.type === "done" || evt.type === "error") {
							qc.setQueryData<ChatMessage[]>(
								keys.conversations.messages(
									workspaceId,
									agentId,
									conversationId,
								),
								(previous) => [...(previous ?? []), evt.assistant],
							);
							setPendingDelta("");
						}
					},
				});
				return null;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				setError(msg);
				return msg;
			} finally {
				setPending(false);
				abortRef.current = null;
			}
		},
		[agentId, conversationId, pending, qc, workspaceId],
	);

	return { send, pendingDelta, pending, error, cancel };
}

/* -------- LLM services -------- */

export function useLlmServices(
	workspaceId: string | undefined,
): UseQueryResult<LlmServiceRecord[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys.llmServices.all(workspaceId)
			: ["llm-services", "disabled"],
		queryFn: () => api.listLlmServices(workspaceId as string),
		enabled: Boolean(workspaceId),
	});
}

export function useLlmService(
	workspaceId: string | undefined,
	llmServiceId: string | undefined,
): UseQueryResult<LlmServiceRecord, Error> {
	return useQuery({
		queryKey:
			workspaceId && llmServiceId
				? keys.llmServices.detail(workspaceId, llmServiceId)
				: ["llm-services", "disabled"],
		queryFn: () =>
			api.getLlmService(workspaceId as string, llmServiceId as string),
		enabled: Boolean(workspaceId && llmServiceId),
	});
}

export function useCreateLlmService(
	workspaceId: string,
): UseMutationResult<LlmServiceRecord, Error, CreateLlmServiceInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateLlmServiceInput) =>
			api.createLlmService(workspaceId, input),
		onSuccess: (svc) => {
			qc.invalidateQueries({ queryKey: keys.llmServices.all(workspaceId) });
			qc.setQueryData(
				keys.llmServices.detail(workspaceId, svc.llmServiceId),
				svc,
			);
		},
	});
}

export function useUpdateLlmService(
	workspaceId: string,
	llmServiceId: string,
): UseMutationResult<LlmServiceRecord, Error, UpdateLlmServiceInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateLlmServiceInput) =>
			api.updateLlmService(workspaceId, llmServiceId, patch),
		onSuccess: (svc) => {
			qc.setQueryData(keys.llmServices.detail(workspaceId, llmServiceId), svc);
			qc.invalidateQueries({ queryKey: keys.llmServices.all(workspaceId) });
		},
	});
}

export function useDeleteLlmService(
	workspaceId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (llmServiceId: string) =>
			api.deleteLlmService(workspaceId, llmServiceId),
		onSuccess: (_data, llmServiceId) => {
			qc.removeQueries({
				queryKey: keys.llmServices.detail(workspaceId, llmServiceId),
			});
			qc.invalidateQueries({ queryKey: keys.llmServices.all(workspaceId) });
		},
	});
}
