import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, formatApiError } from "./api";
import { setAuthToken } from "./authToken";

const WORKSPACE = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	name: "Demo",
	url: null,
	kind: "mock",
	credentials: {},
	keyspace: null,
	rlacEnabled: false,
	createdAt: "2026-05-05T00:00:00.000Z",
	updatedAt: "2026-05-05T00:00:00.000Z",
};

function fetchMock(): ReturnType<typeof vi.fn> {
	return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("formatApiError", () => {
	it("renders ApiError as 'code: message'", () => {
		const err = new ApiError(404, "workspace_not_found", "no such ws", "rid-1");
		expect(formatApiError(err)).toBe("workspace_not_found: no such ws");
	});

	it("falls through to plain Error.message", () => {
		expect(formatApiError(new Error("boom"))).toBe("boom");
	});

	it("returns 'Unknown error' for non-Error values", () => {
		expect(formatApiError(undefined)).toBe("Unknown error");
		expect(formatApiError(null)).toBe("Unknown error");
		expect(formatApiError("string thrown")).toBe("Unknown error");
		expect(formatApiError({ shape: "object" })).toBe("Unknown error");
	});

	it("rewrites the 403 'missing write scope' error into a user-friendly toast", () => {
		// Mirrors the literal string produced by
		// `runtimes/typescript/src/auth/authz.ts:assertScope` when a
		// read-only key tries to mutate. Detecting it on the client
		// side keeps engineering jargon ("authenticated subject is
		// missing required scope 'write'") out of the toaster.
		const err = new ApiError(
			403,
			"forbidden",
			"authenticated subject is missing required scope 'write'",
			"rid-2",
		);
		expect(formatApiError(err)).toBe(
			"This API key is read-only. Mint a key with the Read + Write scope to make changes.",
		);
	});

	it("does NOT rewrite a generic 403 — only the missing-scope shape", () => {
		const err = new ApiError(
			403,
			"forbidden",
			"authenticated subject is not authorized for workspace 'foo'",
			"rid-3",
		);
		expect(formatApiError(err)).toBe(
			"forbidden: authenticated subject is not authorized for workspace 'foo'",
		);
	});
});

describe("api client request contract", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn() as typeof fetch;
		setAuthToken(null);
	});

	afterEach(() => {
		setAuthToken(null);
		globalThis.fetch = originalFetch;
	});

	it("normalizes createWorkspace payload and attaches the bearer token", async () => {
		setAuthToken("wb_live_test_token");
		fetchMock().mockResolvedValue(jsonResponse(WORKSPACE));

		const out = await api.createWorkspace({
			name: "Demo",
			kind: "mock",
			url: "",
			keyspace: "",
			credentials: {
				ASTRA_TOKEN: "env:ASTRA_TOKEN",
				ignored: "",
			},
		});

		expect(out).toMatchObject({ workspaceId: WORKSPACE.workspaceId });
		expect(fetchMock()).toHaveBeenCalledWith(
			"/api/v1/workspaces",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				headers: expect.objectContaining({
					authorization: "Bearer wb_live_test_token",
					"content-type": "application/json",
				}),
				body: JSON.stringify({
					name: "Demo",
					kind: "mock",
					url: null,
					keyspace: null,
					credentials: { ASTRA_TOKEN: "env:ASTRA_TOKEN" },
				}),
			}),
		);
	});

	it("returns undefined for 204 responses without parsing a body", async () => {
		fetchMock().mockResolvedValue(new Response(null, { status: 204 }));

		await expect(
			api.deleteWorkspace("00000000-0000-4000-8000-000000000001"),
		).resolves.toBeUndefined();
	});

	it("throws ApiError from canonical error envelopes", async () => {
		setAuthToken("wb_live_test_token");
		fetchMock().mockResolvedValue(
			jsonResponse(
				{
					error: {
						code: "forbidden",
						message: "not scoped to workspace",
						requestId: "rid-1",
					},
				},
				403,
			),
		);

		await expect(api.listWorkspaces()).rejects.toMatchObject({
			status: 403,
			code: "forbidden",
			message: "not scoped to workspace",
			requestId: "rid-1",
		});
	});

	it("walks cursor-paginated list responses before returning items", async () => {
		const secondWorkspace = {
			...WORKSPACE,
			workspaceId: "00000000-0000-4000-8000-000000000002",
			name: "Second",
		};
		fetchMock()
			.mockResolvedValueOnce(
				jsonResponse({ items: [WORKSPACE], nextCursor: "cursor-2" }),
			)
			.mockResolvedValueOnce(
				jsonResponse({ items: [secondWorkspace], nextCursor: null }),
			);

		await expect(api.listWorkspaces()).resolves.toEqual([
			WORKSPACE,
			secondWorkspace,
		]);
		expect(fetchMock()).toHaveBeenNthCalledWith(
			1,
			"/api/v1/workspaces?limit=200",
			expect.objectContaining({ method: "GET", credentials: "include" }),
		);
		expect(fetchMock()).toHaveBeenNthCalledWith(
			2,
			"/api/v1/workspaces?limit=200&cursor=cursor-2",
			expect.objectContaining({ method: "GET", credentials: "include" }),
		);
	});

	it("falls back to disabled feature flags when discovery is unavailable", async () => {
		fetchMock().mockResolvedValue(jsonResponse({ error: "down" }, 503));

		await expect(api.getFeatures()).resolves.toEqual({
			mcp: { enabled: false, baseUrl: null },
		});
	});

	it("forwards policyDsl and policyEnabled on updateKnowledgeBase (RLAC)", async () => {
		// Regression: the field-whitelisting in `updateKnowledgeBase`
		// previously dropped RLAC fields silently, which made the
		// Access-control preset picker look like a no-op (the PATCH
		// would succeed but the body would be `{}` and the KB row
		// wouldn't change). Pin the wire contract here so a future
		// contributor adding another field can't accidentally drop
		// these again.
		const KB = {
			workspaceId: "00000000-0000-4000-8000-000000000001",
			knowledgeBaseId: "00000000-0000-4000-8000-000000000010",
			name: "demo",
			description: null,
			status: "active",
			embeddingServiceId: "00000000-0000-4000-8000-000000000100",
			chunkingServiceId: "00000000-0000-4000-8000-000000000101",
			rerankingServiceId: null,
			language: null,
			vectorCollection: "demo",
			owned: true,
			lexical: { enabled: false, analyzer: null, options: {} },
			policyDsl:
				"current_principal_id() = ANY(visible_to) OR '*' = ANY(visible_to)",
			policyEnabled: true,
			createdAt: "2026-05-14T00:00:00.000Z",
			updatedAt: "2026-05-14T00:00:01.000Z",
		};
		fetchMock().mockResolvedValue(jsonResponse(KB));

		await api.updateKnowledgeBase(KB.workspaceId, KB.knowledgeBaseId, {
			policyDsl: KB.policyDsl,
			policyEnabled: true,
		});

		const call = fetchMock().mock.calls[0];
		expect(call?.[0]).toBe(
			"/api/v1/workspaces/00000000-0000-4000-8000-000000000001/knowledge-bases/00000000-0000-4000-8000-000000000010",
		);
		const init = call?.[1] as RequestInit;
		expect(init.method).toBe("PATCH");
		const parsed = JSON.parse(init.body as string);
		expect(parsed.policyDsl).toBe(KB.policyDsl);
		expect(parsed.policyEnabled).toBe(true);
	});

	it("forwards policyEnabled: false (turn the policy off) without dropping the field", async () => {
		const KB = {
			workspaceId: "00000000-0000-4000-8000-000000000001",
			knowledgeBaseId: "00000000-0000-4000-8000-000000000010",
			name: "demo",
			description: null,
			status: "active",
			embeddingServiceId: "00000000-0000-4000-8000-000000000100",
			chunkingServiceId: "00000000-0000-4000-8000-000000000101",
			rerankingServiceId: null,
			language: null,
			vectorCollection: "demo",
			owned: true,
			lexical: { enabled: false, analyzer: null, options: {} },
			policyDsl: null,
			policyEnabled: false,
			createdAt: "2026-05-14T00:00:00.000Z",
			updatedAt: "2026-05-14T00:00:01.000Z",
		};
		fetchMock().mockResolvedValue(jsonResponse(KB));

		await api.updateKnowledgeBase(KB.workspaceId, KB.knowledgeBaseId, {
			policyEnabled: false,
		});

		const init = fetchMock().mock.calls[0]?.[1] as RequestInit;
		const parsed = JSON.parse(init.body as string);
		// `policyEnabled: false` is a defined value and must be sent.
		expect(parsed).toHaveProperty("policyEnabled", false);
		// `policyDsl` was not in the patch, so it should not appear on
		// the wire — sending null would clear the stored DSL, which the
		// Access-control "Off" preset deliberately avoids so toggling
		// back on restores the previous policy.
		expect(parsed).not.toHaveProperty("policyDsl");
	});
});
