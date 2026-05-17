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

	it("maps a network failure to HttpError with status 0", async () => {
		mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
		await expect(request({ profile }, "/x", schema)).rejects.toMatchObject({
			status: 0,
			code: "network_error",
		});
	});

	it("rejects non-JSON success bodies with invalid_response", async () => {
		mockFetch.mockResolvedValueOnce(new Response("not json", { status: 200 }));
		await expect(request({ profile }, "/x", schema)).rejects.toBeInstanceOf(
			HttpError,
		);
	});
});
