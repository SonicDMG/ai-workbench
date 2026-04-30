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
	agents: {
		all: (workspaceUid: string) =>
			["workspaces", workspaceUid, "agents"] as const,
		detail: (workspaceUid: string, agentId: string) =>
			["workspaces", workspaceUid, "agents", agentId] as const,
	},
	conversations: {
		all: (workspaceUid: string, agentId: string) =>
			["workspaces", workspaceUid, "agents", agentId, "conversations"] as const,
		detail: (workspaceUid: string, agentId: string, conversationId: string) =>
			[
				"workspaces",
				workspaceUid,
				"agents",
				agentId,
				"conversations",
				conversationId,
			] as const,
		messages: (workspaceUid: string, agentId: string, conversationId: string) =>
			[
				"workspaces",
				workspaceUid,
				"agents",
				agentId,
				"conversations",
				conversationId,
				"messages",
			] as const,
	},
	llmServices: {
		all: (workspaceUid: string) =>
			["workspaces", workspaceUid, "llm-services"] as const,
		detail: (workspaceUid: string, llmServiceId: string) =>
			["workspaces", workspaceUid, "llm-services", llmServiceId] as const,
	},
};
