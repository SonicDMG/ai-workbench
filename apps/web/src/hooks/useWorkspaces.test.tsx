import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/schemas";

// Mock the api module before importing the hook so the QueryClient
// inside the hook never tries to hit `/api/v1/...` against jsdom's
// non-existent server.
vi.mock("@/lib/api", () => ({
	api: {
		listWorkspaces: vi.fn(),
		getWorkspace: vi.fn(),
		createWorkspace: vi.fn(),
		updateWorkspace: vi.fn(),
		deleteWorkspace: vi.fn(),
		testConnection: vi.fn(),
	},
	ApiError: class ApiError extends Error {},
}));

import { api } from "@/lib/api";
import {
	useCreateWorkspace,
	useDeleteWorkspace,
	useTestConnection,
	useUpdateWorkspace,
	useWorkspace,
	useWorkspaces,
} from "./useWorkspaces";

function makeWrapper() {
	const qc = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
	}
	return { wrapper: Wrapper, qc };
}

function wrapper({ children }: { children: ReactNode }) {
	return makeWrapper().wrapper({ children });
}

const fixture: Workspace = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	name: "prod",
	url: "env:ASTRA_DB_API_ENDPOINT",
	kind: "astra",
	credentials: { token: "env:ASTRA_DB_APPLICATION_TOKEN" },
	keyspace: "default_keyspace",
	rlacEnabled: false,
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

describe("useWorkspace (single)", () => {
	it("fetches by id when one is provided", async () => {
		vi.mocked(api.getWorkspace).mockResolvedValueOnce(fixture);
		const { result } = renderHook(() => useWorkspace(fixture.workspaceId), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(api.getWorkspace).toHaveBeenCalledWith(fixture.workspaceId);
		expect(result.current.data).toEqual(fixture);
	});

	it("stays disabled (and never calls the API) when id is undefined", async () => {
		const { result } = renderHook(() => useWorkspace(undefined), { wrapper });
		// Disabled queries report `isPending: true` indefinitely; `fetchStatus` is "idle".
		expect(result.current.fetchStatus).toBe("idle");
		expect(api.getWorkspace).not.toHaveBeenCalled();
	});
});

describe("useCreateWorkspace", () => {
	it("invalidates the workspaces list and seeds the detail cache on success", async () => {
		const created: Workspace = { ...fixture, name: "newly-created" };
		vi.mocked(api.createWorkspace).mockResolvedValueOnce(created);
		const { wrapper: w, qc } = makeWrapper();
		// Pre-seed the list cache so we can detect invalidation.
		qc.setQueryData(["workspaces"], [fixture]);

		const { result } = renderHook(() => useCreateWorkspace(), { wrapper: w });
		await act(async () => {
			await result.current.mutateAsync({
				name: "newly-created",
				kind: "astra",
				url: "env:X",
				credentials: { token: "env:Y" },
				keyspace: "default_keyspace",
			});
		});

		expect(api.createWorkspace).toHaveBeenCalledTimes(1);
		expect(qc.getQueryData(["workspaces", created.workspaceId])).toEqual(
			created,
		);
		// list cache should have been invalidated (stale).
		const listState = qc.getQueryState(["workspaces"]);
		expect(listState?.isInvalidated).toBe(true);
	});

	it("propagates the API error to the mutation", async () => {
		vi.mocked(api.createWorkspace).mockRejectedValueOnce(new Error("nope"));
		const { result } = renderHook(() => useCreateWorkspace(), { wrapper });
		await expect(
			act(async () => {
				await result.current.mutateAsync({
					name: "x",
					kind: "astra",
					url: "env:X",
					credentials: { token: "env:Y" },
					keyspace: "default_keyspace",
				});
			}),
		).rejects.toThrow("nope");
	});
});

describe("useUpdateWorkspace", () => {
	it("seeds the detail cache and invalidates the list on success", async () => {
		const updated: Workspace = { ...fixture, name: "renamed" };
		vi.mocked(api.updateWorkspace).mockResolvedValueOnce(updated);
		const { wrapper: w, qc } = makeWrapper();
		qc.setQueryData(["workspaces"], [fixture]);

		const { result } = renderHook(
			() => useUpdateWorkspace(fixture.workspaceId),
			{ wrapper: w },
		);
		await act(async () => {
			await result.current.mutateAsync({ name: "renamed" });
		});

		expect(api.updateWorkspace).toHaveBeenCalledWith(fixture.workspaceId, {
			name: "renamed",
		});
		expect(qc.getQueryData(["workspaces", fixture.workspaceId])).toEqual(
			updated,
		);
		expect(qc.getQueryState(["workspaces"])?.isInvalidated).toBe(true);
	});
});

describe("useDeleteWorkspace", () => {
	it("removes the detail cache entry and invalidates the list", async () => {
		vi.mocked(api.deleteWorkspace).mockResolvedValueOnce(undefined);
		const { wrapper: w, qc } = makeWrapper();
		qc.setQueryData(["workspaces"], [fixture]);
		qc.setQueryData(["workspaces", fixture.workspaceId], fixture);

		const { result } = renderHook(() => useDeleteWorkspace(), { wrapper: w });
		await act(async () => {
			await result.current.mutateAsync(fixture.workspaceId);
		});

		// React-query 5 passes (variables, context) to a directly-passed
		// mutationFn; we only assert on the first arg.
		expect(api.deleteWorkspace).toHaveBeenCalledOnce();
		expect(vi.mocked(api.deleteWorkspace).mock.calls[0]?.[0]).toBe(
			fixture.workspaceId,
		);
		expect(
			qc.getQueryData(["workspaces", fixture.workspaceId]),
		).toBeUndefined();
		expect(qc.getQueryState(["workspaces"])?.isInvalidated).toBe(true);
	});
});

describe("useTestConnection", () => {
	it("calls api.testConnection with the bound workspace id", async () => {
		const result_: TestConnectionPayload = { ok: true, latencyMs: 12 };
		vi.mocked(api.testConnection).mockResolvedValueOnce(
			result_ as unknown as Parameters<
				typeof api.testConnection
			>[0] extends never
				? never
				: Awaited<ReturnType<typeof api.testConnection>>,
		);
		const { result } = renderHook(
			() => useTestConnection(fixture.workspaceId),
			{ wrapper },
		);
		await act(async () => {
			await result.current.mutateAsync();
		});
		expect(api.testConnection).toHaveBeenCalledWith(fixture.workspaceId);
	});
});

interface TestConnectionPayload {
	readonly ok: boolean;
	readonly latencyMs: number;
}
