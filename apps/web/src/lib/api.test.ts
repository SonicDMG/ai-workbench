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

	it("falls back to disabled feature flags when discovery is unavailable", async () => {
		fetchMock().mockResolvedValue(jsonResponse({ error: "down" }, 503));

		await expect(api.getFeatures()).resolves.toEqual({
			mcp: { enabled: false, baseUrl: null },
		});
	});
});
