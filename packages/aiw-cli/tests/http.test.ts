import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Profile } from "../src/config.js";
import { buildUrl, HttpError, request } from "../src/http.js";

const profile: Profile = { url: "http://api.example", apiKey: "test-key" };

describe("buildUrl", () => {
	it("joins base + path", () => {
		expect(buildUrl("http://a", "/x")).toBe("http://a/x");
	});

	it("trims trailing slashes from the base", () => {
		expect(buildUrl("http://a//", "/x")).toBe("http://a/x");
	});

	it("adds query parameters", () => {
		const url = buildUrl("http://a", "/x", { q: "hello world", n: 5 });
		const u = new URL(url);
		expect(u.searchParams.get("q")).toBe("hello world");
		expect(u.searchParams.get("n")).toBe("5");
	});

	it("skips undefined query values", () => {
		const url = buildUrl("http://a", "/x", { a: "1", b: undefined });
		expect(url).not.toContain("b=");
	});
});

describe("request", () => {
	const schema = z.object({ ok: z.boolean() });
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockFetch = vi.fn();
		(globalThis as { fetch: typeof fetch }).fetch =
			mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sets the Authorization header from the profile's apiKey", async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);
		await request({ profile }, "/api/v1/ping", schema);
		const call = mockFetch.mock.calls[0];
		if (!call) throw new Error("fetch was not called");
		const init = call[1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer test-key",
		);
	});

	it("prefers an oidc accessToken over the apiKey when both are present", async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);
		const oidcProfile: Profile = {
			url: "http://api.example",
			apiKey: "legacy-key",
			oidc: { accessToken: "oidc.jwt.token", tokenType: "Bearer" },
		};
		await request({ profile: oidcProfile }, "/api/v1/ping", schema);
		const call = mockFetch.mock.calls[0];
		if (!call) throw new Error("fetch was not called");
		const init = call[1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer oidc.jwt.token",
		);
	});

	it("honors a non-default oidc tokenType when set", async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);
		const oidcProfile: Profile = {
			url: "http://api.example",
			oidc: { accessToken: "dpop.token.value", tokenType: "DPoP" },
		};
		await request({ profile: oidcProfile }, "/api/v1/ping", schema);
		const call = mockFetch.mock.calls[0];
		if (!call) throw new Error("fetch was not called");
		const init = call[1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"DPoP dpop.token.value",
		);
	});

	it("JSON-encodes object bodies and adds the content-type", async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);
		await request({ profile }, "/api/v1/things", schema, {
			method: "POST",
			body: { name: "x" },
		});
		const call = mockFetch.mock.calls[0];
		if (!call) throw new Error("fetch was not called");
		const init = call[1] as RequestInit;
		expect(init.body).toBe(JSON.stringify({ name: "x" }));
		expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
			"application/json",
		);
	});

	it("decodes the error envelope on non-2xx", async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					error: { code: "scope_required", message: "needs write" },
				}),
				{ status: 403 },
			),
		);
		await expect(request({ profile }, "/x", schema)).rejects.toMatchObject({
			name: "HttpError",
			status: 403,
			code: "scope_required",
			message: "needs write",
		});
	});

	it("propagates hint, docs, and requestId from the envelope", async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					error: {
						code: "workspace_not_found",
						message: "missing",
						hint: "Run `aiw workspace list`.",
						docs: "docs/errors.md#workspace-not-found",
						requestId: "01HY2Z...",
					},
				}),
				{ status: 404 },
			),
		);
		await expect(request({ profile }, "/x", schema)).rejects.toMatchObject({
			status: 404,
			code: "workspace_not_found",
			hint: "Run `aiw workspace list`.",
			docs: "docs/errors.md#workspace-not-found",
			requestId: "01HY2Z...",
		});
	});

	it("never retries a 4xx response", async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: { code: "bad", message: "no" } }), {
				status: 400,
			}),
		);
		await expect(
			request({ profile }, "/x", schema, { retries: 3 }),
		).rejects.toMatchObject({ status: 400 });
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("retries a network failure once by default, then surfaces network_error", async () => {
		mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
		await expect(request({ profile }, "/x", schema)).rejects.toMatchObject({
			status: 0,
			code: "network_error",
		});
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("succeeds on the second attempt when the first is a transient network error", async () => {
		mockFetch
			.mockRejectedValueOnce(new Error("ECONNRESET"))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), { status: 200 }),
			);
		await expect(request({ profile }, "/x", schema)).resolves.toEqual({
			ok: true,
		});
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("honours retries: 0 (no retry on network errors)", async () => {
		mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
		await expect(
			request({ profile }, "/x", schema, { retries: 0 }),
		).rejects.toMatchObject({ code: "network_error" });
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("aborts on its own timeout and surfaces request_timeout", async () => {
		mockFetch.mockImplementation(
			(_: unknown, init?: RequestInit) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
					});
				}),
		);
		await expect(
			request({ profile }, "/x", schema, { timeoutMs: 25, retries: 0 }),
		).rejects.toMatchObject({ code: "request_timeout" });
	});

	it("rejects non-JSON success bodies with invalid_response", async () => {
		mockFetch.mockResolvedValueOnce(new Response("not json", { status: 200 }));
		await expect(request({ profile }, "/x", schema)).rejects.toBeInstanceOf(
			HttpError,
		);
	});
});
