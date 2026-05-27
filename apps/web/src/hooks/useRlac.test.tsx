import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
	PolicyAuditRecord,
	PolicyCompilePreviewResponse,
	PrincipalRecord,
	Workspace,
} from "@/lib/schemas";

// Mock the api + the useWorkspace hook (used transitively by useRlacEnabled).
vi.mock("@/lib/api", () => ({
	api: {
		listPrincipals: vi.fn(),
		createPrincipal: vi.fn(),
		updatePrincipal: vi.fn(),
		deletePrincipal: vi.fn(),
		compilePolicy: vi.fn(),
		listPolicyAudit: vi.fn(),
		getWorkspace: vi.fn(),
	},
	ApiError: class ApiError extends Error {},
}));

import { api } from "@/lib/api";
import {
	useCreatePrincipal,
	useDeletePrincipal,
	usePolicyAudit,
	usePolicyCompilePreview,
	usePrincipals,
	useRlacEnabled,
	useUpdatePrincipal,
} from "./useRlac";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const PRINCIPAL_ID = "alice@corp.example";

const baseWorkspace: Workspace = {
	workspaceId: WORKSPACE_ID,
	name: "prod",
	url: "env:U",
	kind: "astra",
	credentials: { token: "env:T" },
	keyspace: "default_keyspace",
	rlacEnabled: false,
	createdAt: "2026-04-22T10:11:12.345Z",
	updatedAt: "2026-04-22T10:11:12.345Z",
};

const samplePrincipal: PrincipalRecord = {
	workspaceId: WORKSPACE_ID,
	principalId: PRINCIPAL_ID,
	label: "Alice",
	attributes: { dept: "platform" },
	createdAt: "2026-04-22T10:11:12.345Z",
	updatedAt: "2026-04-22T10:11:12.345Z",
};

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

describe("useRlacEnabled", () => {
	it("returns false while the workspace is loading", () => {
		// getWorkspace never resolves in this test → query stays loading.
		vi.mocked(api.getWorkspace).mockReturnValueOnce(
			new Promise(() => {}) as ReturnType<typeof api.getWorkspace>,
		);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRlacEnabled(WORKSPACE_ID), {
			wrapper,
		});
		expect(result.current).toBe(false);
	});

	it("returns false for an undefined workspace id", () => {
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRlacEnabled(undefined), { wrapper });
		expect(result.current).toBe(false);
		expect(api.getWorkspace).not.toHaveBeenCalled();
	});

	it("returns true once the workspace resolves with rlacEnabled:true", async () => {
		vi.mocked(api.getWorkspace).mockResolvedValueOnce({
			...baseWorkspace,
			rlacEnabled: true,
		});
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRlacEnabled(WORKSPACE_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current).toBe(true));
	});

	it("returns false when the workspace resolves with rlacEnabled:false", async () => {
		vi.mocked(api.getWorkspace).mockResolvedValueOnce(baseWorkspace);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRlacEnabled(WORKSPACE_ID), {
			wrapper,
		});
		// Wait a tick for the resolution.
		await waitFor(() => expect(vi.mocked(api.getWorkspace)).toHaveBeenCalled());
		expect(result.current).toBe(false);
	});
});

describe("usePrincipals", () => {
	it("fetches when workspaceId is provided", async () => {
		vi.mocked(api.listPrincipals).mockResolvedValueOnce([samplePrincipal]);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => usePrincipals(WORKSPACE_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual([samplePrincipal]);
		expect(api.listPrincipals).toHaveBeenCalledWith(WORKSPACE_ID);
	});

	it("stays disabled when no workspaceId", () => {
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => usePrincipals(undefined), { wrapper });
		expect(result.current.fetchStatus).toBe("idle");
		expect(api.listPrincipals).not.toHaveBeenCalled();
	});
});

describe("useCreatePrincipal / useUpdatePrincipal / useDeletePrincipal", () => {
	it("create invalidates the principals list", async () => {
		vi.mocked(api.createPrincipal).mockResolvedValueOnce(samplePrincipal);
		const { wrapper, qc } = makeWrapper();
		qc.setQueryData(["workspaces", WORKSPACE_ID, "principals"], []);
		const { result } = renderHook(() => useCreatePrincipal(WORKSPACE_ID), {
			wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({ principalId: PRINCIPAL_ID });
		});
		expect(api.createPrincipal).toHaveBeenCalledWith(WORKSPACE_ID, {
			principalId: PRINCIPAL_ID,
		});
		expect(
			qc.getQueryState(["workspaces", WORKSPACE_ID, "principals"])
				?.isInvalidated,
		).toBe(true);
	});

	it("update fires through to the api with both ids", async () => {
		vi.mocked(api.updatePrincipal).mockResolvedValueOnce({
			...samplePrincipal,
			label: "Alice Updated",
		});
		const { wrapper } = makeWrapper();
		const { result } = renderHook(
			() => useUpdatePrincipal(WORKSPACE_ID, PRINCIPAL_ID),
			{ wrapper },
		);
		await act(async () => {
			await result.current.mutateAsync({ label: "Alice Updated" });
		});
		expect(api.updatePrincipal).toHaveBeenCalledWith(
			WORKSPACE_ID,
			PRINCIPAL_ID,
			{ label: "Alice Updated" },
		);
	});

	it("delete invalidates the principals list", async () => {
		vi.mocked(api.deletePrincipal).mockResolvedValueOnce(undefined);
		const { wrapper, qc } = makeWrapper();
		qc.setQueryData(
			["workspaces", WORKSPACE_ID, "principals"],
			[samplePrincipal],
		);
		const { result } = renderHook(() => useDeletePrincipal(WORKSPACE_ID), {
			wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync(PRINCIPAL_ID);
		});
		expect(vi.mocked(api.deletePrincipal).mock.calls[0]?.[0]).toBe(
			WORKSPACE_ID,
		);
		expect(vi.mocked(api.deletePrincipal).mock.calls[0]?.[1]).toBe(
			PRINCIPAL_ID,
		);
		expect(
			qc.getQueryState(["workspaces", WORKSPACE_ID, "principals"])
				?.isInvalidated,
		).toBe(true);
	});
});

describe("usePolicyCompilePreview", () => {
	const preview: PolicyCompilePreviewResponse = {
		ok: true,
		parseError: null,
		issues: [],
		compiledFilter: { $or: [] },
		principalId: PRINCIPAL_ID,
	};

	it("compiles when both workspaceId and a non-blank dsl are present", async () => {
		vi.mocked(api.compilePolicy).mockResolvedValueOnce(preview);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(
			() =>
				usePolicyCompilePreview(
					WORKSPACE_ID,
					"owner_id = $principal.id",
					PRINCIPAL_ID,
				),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(api.compilePolicy).toHaveBeenCalledWith(WORKSPACE_ID, {
			dsl: "owner_id = $principal.id",
			principalId: PRINCIPAL_ID,
		});
	});

	it("does not fire when dsl is whitespace-only", () => {
		const { wrapper } = makeWrapper();
		const { result } = renderHook(
			() => usePolicyCompilePreview(WORKSPACE_ID, "   ", null),
			{ wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
		expect(api.compilePolicy).not.toHaveBeenCalled();
	});

	it("does not fire when workspaceId is undefined", () => {
		const { wrapper } = makeWrapper();
		const { result } = renderHook(
			() => usePolicyCompilePreview(undefined, "true", null),
			{ wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});

	it("uses undefined (not null) when principalId is null", async () => {
		vi.mocked(api.compilePolicy).mockResolvedValueOnce(preview);
		const { wrapper } = makeWrapper();
		renderHook(() => usePolicyCompilePreview(WORKSPACE_ID, "true", null), {
			wrapper,
		});
		await waitFor(() =>
			expect(api.compilePolicy).toHaveBeenCalledWith(WORKSPACE_ID, {
				dsl: "true",
				principalId: undefined,
			}),
		);
	});
});

describe("usePolicyAudit", () => {
	const auditRow: PolicyAuditRecord = {
		workspaceId: WORKSPACE_ID,
		auditDay: "2026-05-27",
		ts: "2026-05-27T12:00:00.000Z",
		decisionId: "00000000-0000-4000-8000-aaaaaaaaaaaa",
		principalId: PRINCIPAL_ID,
		knowledgeBaseId: "00000000-0000-4000-8000-bbbbbbbbbbbb",
		resourceId: "doc-1",
		action: "list",
		decision: "filter",
		reason: "rlac_filter",
		compiledFilterJson: '{"$or":[]}',
	};

	it("queries with the supplied filter object", async () => {
		vi.mocked(api.listPolicyAudit).mockResolvedValueOnce([auditRow]);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(
			() =>
				usePolicyAudit(WORKSPACE_ID, { principalId: PRINCIPAL_ID, limit: 50 }),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(api.listPolicyAudit).toHaveBeenCalledWith(WORKSPACE_ID, {
			principalId: PRINCIPAL_ID,
			limit: 50,
		});
	});

	it("stays disabled when no workspaceId", () => {
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => usePolicyAudit(undefined), { wrapper });
		expect(result.current.fetchStatus).toBe("idle");
	});
});
