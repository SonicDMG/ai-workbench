import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import { sendChatStream } from "@/lib/chatStream";
import { keys } from "@/lib/query";
import type {
	Chat,
	ChatMessage,
	CreateChatInput,
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
 * Streaming variant. Returns:
 *   - `send(content)` to fire a turn,
 *   - `pendingDelta` accumulating the in-flight token buffer,
 *   - `pending` boolean for the whole turn lifecycle,
 *   - `cancel()` to abort the in-flight stream.
 *
 * The hook drives the cached message list via react-query so the
 * regular `useChatMessages` hook keeps rendering the canonical view.
 * The `pendingDelta` is a separate piece of UI state for "live"
 * tokens that haven't been persisted yet — once the stream emits
 * `done` / `error`, the cache appends the canonical assistant row
 * and `pendingDelta` is cleared.
 */
export interface SendChatStreamHandle {
	readonly send: (content: string) => Promise<void>;
	readonly pendingDelta: string;
	readonly pending: boolean;
	readonly error: string | null;
	readonly cancel: () => void;
}

export function useSendChatStream(
	workspaceUid: string,
	chatId: string,
): SendChatStreamHandle {
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
				await sendChatStream(workspaceUid, chatId, {
					content,
					signal: ctrl.signal,
					onEvent: (evt) => {
						if (evt.type === "user-message") {
							qc.setQueryData<ChatMessage[]>(
								keys.chats.messages(workspaceUid, chatId),
								(previous) => [...(previous ?? []), evt.message],
							);
						} else if (evt.type === "token") {
							buffer += evt.delta;
							setPendingDelta(buffer);
						} else if (evt.type === "done" || evt.type === "error") {
							qc.setQueryData<ChatMessage[]>(
								keys.chats.messages(workspaceUid, chatId),
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
		[chatId, pending, qc, workspaceUid],
	);

	return { send, pendingDelta, pending, error, cancel };
}
