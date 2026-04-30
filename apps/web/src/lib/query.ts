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
		detail: (workspaceId: string) => ["workspaces", workspaceId] as const,
	},
	agents: {
		all: (workspaceId: string) =>
			["workspaces", workspaceId, "agents"] as const,
		detail: (workspaceId: string, agentId: string) =>
			["workspaces", workspaceId, "agents", agentId] as const,
	},
	conversations: {
		all: (workspaceId: string, agentId: string) =>
			["workspaces", workspaceId, "agents", agentId, "conversations"] as const,
		detail: (workspaceId: string, agentId: string, conversationId: string) =>
			[
				"workspaces",
				workspaceId,
				"agents",
				agentId,
				"conversations",
				conversationId,
			] as const,
		messages: (workspaceId: string, agentId: string, conversationId: string) =>
			[
				"workspaces",
				workspaceId,
				"agents",
				agentId,
				"conversations",
				conversationId,
				"messages",
			] as const,
	},
	llmServices: {
		all: (workspaceId: string) =>
			["workspaces", workspaceId, "llm-services"] as const,
		detail: (workspaceId: string, llmServiceId: string) =>
			["workspaces", workspaceId, "llm-services", llmServiceId] as const,
	},
};
