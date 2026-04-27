import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/schemas";

// Mock the api module before importing the hook so the QueryClient
// inside the hook never tries to hit `/api/v1/...` against jsdom's
// non-existent server.
vi.mock("@/lib/api", () => ({
	api: {
		listWorkspaces: vi.fn(),
	},
	ApiError: class ApiError extends Error {},
}));

import { api } from "@/lib/api";
import { useWorkspaces } from "./useWorkspaces";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const fixture: Workspace = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	name: "prod",
	url: "env:ASTRA_DB_API_ENDPOINT",
	kind: "astra",
	credentials: { token: "env:ASTRA_DB_APPLICATION_TOKEN" },
	keyspace: "default_keyspace",
	createdAt: "2026-04-22T10:11:12.345Z",
	updatedAt: "2026-04-22T10:11:12.345Z",
};

describe("useWorkspaces", () => {
	it("flows the api response into query data", async () => {
		vi.mocked(api.listWorkspaces).mockResolvedValueOnce([fixture]);

		const { result } = renderHook(() => useWorkspaces(), { wrapper });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual([fixture]);
		expect(api.listWorkspaces).toHaveBeenCalledTimes(1);
	});

	it("surfaces api errors as the query error", async () => {
		vi.mocked(api.listWorkspaces).mockRejectedValueOnce(new Error("boom"));

		const { result } = renderHook(() => useWorkspaces(), { wrapper });

		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(result.current.error).toBeInstanceOf(Error);
		expect(result.current.error?.message).toBe("boom");
	});
});
