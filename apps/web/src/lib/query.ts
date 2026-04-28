import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: (failureCount, error) => {
				// Don't retry on 4xx — they're user errors, retry won't fix them.
				if (error instanceof Error && "status" in error) {
					const status = (error as unknown as { status: number }).status;
					if (status >= 400 && status < 500) return false;
				}
				return failureCount < 2;
			},
			staleTime: 10_000,
		},
	},
});

export const keys = {
	workspaces: {
		all: ["workspaces"] as const,
		detail: (uid: string) => ["workspaces", uid] as const,
	},
	chats: {
		all: (workspaceUid: string) => ["chats", workspaceUid] as const,
		detail: (workspaceUid: string, chatId: string) =>
			["chats", workspaceUid, chatId] as const,
		messages: (workspaceUid: string, chatId: string) =>
			["chats", workspaceUid, chatId, "messages"] as const,
	},
};
