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
	Chat,
	ChatMessage,
	CreateChatInput,
	SendChatMessageInput,
	SendChatMessageResponse,
	UpdateChatInput,
} from "@/lib/schemas";

export function useChats(
	workspaceUid: string | undefined,
): UseQueryResult<Chat[], Error> {
	return useQuery({
		queryKey: workspaceUid
			? keys.chats.all(workspaceUid)
			: ["chats", "disabled"],
		queryFn: () => api.listChats(workspaceUid as string),
		enabled: Boolean(workspaceUid),
	});
}

export function useChat(
	workspaceUid: string | undefined,
	chatId: string | undefined,
): UseQueryResult<Chat, Error> {
	return useQuery({
		queryKey:
			workspaceUid && chatId
				? keys.chats.detail(workspaceUid, chatId)
				: ["chats", "disabled"],
		queryFn: () => api.getChat(workspaceUid as string, chatId as string),
		enabled: Boolean(workspaceUid && chatId),
	});
}

export function useChatMessages(
	workspaceUid: string | undefined,
	chatId: string | undefined,
): UseQueryResult<ChatMessage[], Error> {
	return useQuery({
		queryKey:
			workspaceUid && chatId
				? keys.chats.messages(workspaceUid, chatId)
				: ["chats", "disabled"],
		queryFn: () =>
			api.listChatMessages(workspaceUid as string, chatId as string),
		enabled: Boolean(workspaceUid && chatId),
	});
}

export function useCreateChat(
	workspaceUid: string,
): UseMutationResult<Chat, Error, CreateChatInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateChatInput) => api.createChat(workspaceUid, input),
		onSuccess: (chat) => {
			qc.invalidateQueries({ queryKey: keys.chats.all(workspaceUid) });
			qc.setQueryData(keys.chats.detail(workspaceUid, chat.chatId), chat);
		},
	});
}

export function useUpdateChat(
	workspaceUid: string,
	chatId: string,
): UseMutationResult<Chat, Error, UpdateChatInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateChatInput) =>
			api.updateChat(workspaceUid, chatId, patch),
		onSuccess: (chat) => {
			qc.setQueryData(keys.chats.detail(workspaceUid, chatId), chat);
			qc.invalidateQueries({ queryKey: keys.chats.all(workspaceUid) });
		},
	});
}

export function useDeleteChat(
	workspaceUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (chatId: string) => api.deleteChat(workspaceUid, chatId),
		onSuccess: (_data, chatId) => {
			qc.removeQueries({ queryKey: keys.chats.detail(workspaceUid, chatId) });
			qc.removeQueries({
				queryKey: keys.chats.messages(workspaceUid, chatId),
			});
			qc.invalidateQueries({ queryKey: keys.chats.all(workspaceUid) });
		},
	});
}

/**
 * Send a user message and append both turns (user + Bobbie's reply)
 * to the cached message list. Phase 5 will swap this for an
 * EventSource-backed streaming variant that emits tokens as they
 * arrive; the UI reducer will be the same shape so the swap is
 * invisible to consumers.
 */
export function useSendChatMessage(
	workspaceUid: string,
	chatId: string,
): UseMutationResult<SendChatMessageResponse, Error, SendChatMessageInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: SendChatMessageInput) =>
			api.sendChatMessage(workspaceUid, chatId, input),
		onSuccess: (response) => {
			qc.setQueryData<ChatMessage[]>(
				keys.chats.messages(workspaceUid, chatId),
				(previous) => [...(previous ?? []), response.user, response.assistant],
			);
		},
	});
}
