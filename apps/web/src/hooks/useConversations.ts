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
	workspaceUid: string | undefined,
): UseQueryResult<AgentRecord[], Error> {
	return useQuery({
		queryKey: workspaceUid
			? keys.agents.all(workspaceUid)
			: ["agents", "disabled"],
		queryFn: () => api.listAgents(workspaceUid as string),
		enabled: Boolean(workspaceUid),
	});
}

export function useAgent(
	workspaceUid: string | undefined,
	agentId: string | undefined,
): UseQueryResult<AgentRecord, Error> {
	return useQuery({
		queryKey:
			workspaceUid && agentId
				? keys.agents.detail(workspaceUid, agentId)
				: ["agents", "disabled"],
		queryFn: () => api.getAgent(workspaceUid as string, agentId as string),
		enabled: Boolean(workspaceUid && agentId),
	});
}

export function useCreateAgent(
	workspaceUid: string,
): UseMutationResult<AgentRecord, Error, CreateAgentInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateAgentInput) =>
			api.createAgent(workspaceUid, input),
		onSuccess: (agent) => {
			qc.invalidateQueries({ queryKey: keys.agents.all(workspaceUid) });
			qc.setQueryData(keys.agents.detail(workspaceUid, agent.agentId), agent);
		},
	});
}

export function useUpdateAgent(
	workspaceUid: string,
	agentId: string,
): UseMutationResult<AgentRecord, Error, UpdateAgentInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateAgentInput) =>
			api.updateAgent(workspaceUid, agentId, patch),
		onSuccess: (agent) => {
			qc.setQueryData(keys.agents.detail(workspaceUid, agentId), agent);
			qc.invalidateQueries({ queryKey: keys.agents.all(workspaceUid) });
		},
	});
}

export function useDeleteAgent(
	workspaceUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (agentId: string) => api.deleteAgent(workspaceUid, agentId),
		onSuccess: (_data, agentId) => {
			qc.removeQueries({ queryKey: keys.agents.detail(workspaceUid, agentId) });
			qc.removeQueries({
				queryKey: keys.conversations.all(workspaceUid, agentId),
			});
			qc.invalidateQueries({ queryKey: keys.agents.all(workspaceUid) });
		},
	});
}

/* -------- Conversations -------- */

export function useConversations(
	workspaceUid: string | undefined,
	agentId: string | undefined,
): UseQueryResult<ConversationRecord[], Error> {
	return useQuery({
		queryKey:
			workspaceUid && agentId
				? keys.conversations.all(workspaceUid, agentId)
				: ["conversations", "disabled"],
		queryFn: () =>
			api.listConversations(workspaceUid as string, agentId as string),
		enabled: Boolean(workspaceUid && agentId),
	});
}

export function useConversation(
	workspaceUid: string | undefined,
	agentId: string | undefined,
	conversationId: string | undefined,
): UseQueryResult<ConversationRecord, Error> {
	return useQuery({
		queryKey:
			workspaceUid && agentId && conversationId
				? keys.conversations.detail(workspaceUid, agentId, conversationId)
				: ["conversations", "disabled"],
		queryFn: () =>
			api.getConversation(
				workspaceUid as string,
				agentId as string,
				conversationId as string,
			),
		enabled: Boolean(workspaceUid && agentId && conversationId),
	});
}

export function useCreateConversation(
	workspaceUid: string,
	agentId: string,
): UseMutationResult<ConversationRecord, Error, CreateConversationInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateConversationInput) =>
			api.createConversation(workspaceUid, agentId, input),
		onSuccess: (conv) => {
			qc.invalidateQueries({
				queryKey: keys.conversations.all(workspaceUid, agentId),
			});
			qc.setQueryData(
				keys.conversations.detail(workspaceUid, agentId, conv.conversationId),
				conv,
			);
		},
	});
}

export function useUpdateConversation(
	workspaceUid: string,
	agentId: string,
	conversationId: string,
): UseMutationResult<ConversationRecord, Error, UpdateConversationInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateConversationInput) =>
			api.updateConversation(workspaceUid, agentId, conversationId, patch),
		onSuccess: (conv) => {
			qc.setQueryData(
				keys.conversations.detail(workspaceUid, agentId, conversationId),
				conv,
			);
			qc.invalidateQueries({
				queryKey: keys.conversations.all(workspaceUid, agentId),
			});
		},
	});
}

export function useDeleteConversation(
	workspaceUid: string,
	agentId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (conversationId: string) =>
			api.deleteConversation(workspaceUid, agentId, conversationId),
		onSuccess: (_data, conversationId) => {
			qc.removeQueries({
				queryKey: keys.conversations.detail(
					workspaceUid,
					agentId,
					conversationId,
				),
			});
			qc.removeQueries({
				queryKey: keys.conversations.messages(
					workspaceUid,
					agentId,
					conversationId,
				),
			});
			qc.invalidateQueries({
				queryKey: keys.conversations.all(workspaceUid, agentId),
			});
		},
	});
}

export function useConversationMessages(
	workspaceUid: string | undefined,
	agentId: string | undefined,
	conversationId: string | undefined,
): UseQueryResult<ChatMessage[], Error> {
	return useQuery({
		queryKey:
			workspaceUid && agentId && conversationId
				? keys.conversations.messages(workspaceUid, agentId, conversationId)
				: ["conversations", "disabled"],
		queryFn: () =>
			api.listConversationMessages(
				workspaceUid as string,
				agentId as string,
				conversationId as string,
			),
		enabled: Boolean(workspaceUid && agentId && conversationId),
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
	readonly send: (content: string) => Promise<void>;
	readonly pendingDelta: string;
	readonly pending: boolean;
	readonly error: string | null;
	readonly cancel: () => void;
}

export function useSendConversationStream(
	workspaceUid: string,
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
		async (content: string) => {
			if (pending) return;
			const ctrl = new AbortController();
			abortRef.current = ctrl;
			setPending(true);
			setPendingDelta("");
			setError(null);
			try {
				let buffer = "";
				await sendConversationStream(workspaceUid, agentId, conversationId, {
					content,
					signal: ctrl.signal,
					onEvent: (evt) => {
						if (evt.type === "user-message") {
							qc.setQueryData<ChatMessage[]>(
								keys.conversations.messages(
									workspaceUid,
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
									workspaceUid,
									agentId,
									conversationId,
								),
								(previous) => [...(previous ?? []), evt.assistant],
							);
							setPendingDelta("");
						}
					},
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				setError(msg);
			} finally {
				setPending(false);
				abortRef.current = null;
			}
		},
		[agentId, conversationId, pending, qc, workspaceUid],
	);

	return { send, pendingDelta, pending, error, cancel };
}

/* -------- LLM services -------- */

export function useLlmServices(
	workspaceUid: string | undefined,
): UseQueryResult<LlmServiceRecord[], Error> {
	return useQuery({
		queryKey: workspaceUid
			? keys.llmServices.all(workspaceUid)
			: ["llm-services", "disabled"],
		queryFn: () => api.listLlmServices(workspaceUid as string),
		enabled: Boolean(workspaceUid),
	});
}

export function useLlmService(
	workspaceUid: string | undefined,
	llmServiceId: string | undefined,
): UseQueryResult<LlmServiceRecord, Error> {
	return useQuery({
		queryKey:
			workspaceUid && llmServiceId
				? keys.llmServices.detail(workspaceUid, llmServiceId)
				: ["llm-services", "disabled"],
		queryFn: () =>
			api.getLlmService(workspaceUid as string, llmServiceId as string),
		enabled: Boolean(workspaceUid && llmServiceId),
	});
}

export function useCreateLlmService(
	workspaceUid: string,
): UseMutationResult<LlmServiceRecord, Error, CreateLlmServiceInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateLlmServiceInput) =>
			api.createLlmService(workspaceUid, input),
		onSuccess: (svc) => {
			qc.invalidateQueries({ queryKey: keys.llmServices.all(workspaceUid) });
			qc.setQueryData(
				keys.llmServices.detail(workspaceUid, svc.llmServiceId),
				svc,
			);
		},
	});
}

export function useUpdateLlmService(
	workspaceUid: string,
	llmServiceId: string,
): UseMutationResult<LlmServiceRecord, Error, UpdateLlmServiceInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateLlmServiceInput) =>
			api.updateLlmService(workspaceUid, llmServiceId, patch),
		onSuccess: (svc) => {
			qc.setQueryData(keys.llmServices.detail(workspaceUid, llmServiceId), svc);
			qc.invalidateQueries({ queryKey: keys.llmServices.all(workspaceUid) });
		},
	});
}

export function useDeleteLlmService(
	workspaceUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (llmServiceId: string) =>
			api.deleteLlmService(workspaceUid, llmServiceId),
		onSuccess: (_data, llmServiceId) => {
			qc.removeQueries({
				queryKey: keys.llmServices.detail(workspaceUid, llmServiceId),
			});
			qc.invalidateQueries({ queryKey: keys.llmServices.all(workspaceUid) });
		},
	});
}
