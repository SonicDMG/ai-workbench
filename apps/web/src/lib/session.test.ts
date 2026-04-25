import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshSession } from "./session";

describe("refreshSession", () => {
	const originalFetch = globalThis.fetch;
	beforeEach(() => {
		globalThis.fetch = vi.fn() as typeof fetch;
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns the new expiry when the runtime says ok", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ ok: true, expiresAt: 12345 }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const out = await refreshSession("/auth/refresh");
		expect(out).toEqual({ ok: true, expiresAt: 12345 });
	});

	it("returns null when the runtime returns 401", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: { code: "refresh_failed" } }), {
				status: 401,
			}),
		);
		expect(await refreshSession("/auth/refresh")).toBeNull();
	});

	it("returns null when the body is missing ok: true", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ expiresAt: 999 }), { status: 200 }),
		);
		expect(await refreshSession("/auth/refresh")).toBeNull();
	});

	it("swallows network errors as null", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("network down"),
		);
		expect(await refreshSession("/auth/refresh")).toBeNull();
	});
});
