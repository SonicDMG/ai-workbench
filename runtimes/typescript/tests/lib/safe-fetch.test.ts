import { afterEach, describe, expect, test, vi } from "vitest";
import { safeFetch } from "../../src/lib/safe-fetch.js";

describe("safeFetch", () => {
	afterEach(() => vi.restoreAllMocks());

	test("forces redirect: 'error' when caller passed no init", async () => {
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 200 }));

		await safeFetch("https://example.com/");

		const init = spy.mock.calls[0]?.[1];
		expect(init?.redirect).toBe("error");
	});

	test("overrides a caller-supplied redirect: 'follow'", async () => {
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 200 }));

		await safeFetch("https://example.com/", {
			method: "POST",
			redirect: "follow",
			headers: { "x-test": "1" },
		});

		const [, init] = spy.mock.calls[0] ?? [];
		expect(init?.redirect).toBe("error");
		expect(init?.method).toBe("POST");
		expect((init?.headers as Record<string, string>)["x-test"]).toBe("1");
	});

	test("rejects when the server responds with a redirect", async () => {
		// Spin up a tiny in-process redirector to assert the runtime
		// behavior end-to-end. `redirect: 'error'` makes Node's fetch
		// throw a TypeError on the first 30x rather than silently chase
		// the Location header.
		const { createServer } = await import("node:http");
		const server = createServer((_req, res) => {
			res.writeHead(302, { Location: "http://169.254.169.254/" });
			res.end();
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const addr = server.address() as { port: number };
		try {
			let caught: unknown = null;
			try {
				await safeFetch(`http://127.0.0.1:${addr.port}/`);
			} catch (err) {
				caught = err;
			}
			expect(caught).toBeInstanceOf(Error);
			// Node wraps the underlying RedirectError as `cause`.
			const causeMsg =
				(caught as { cause?: { message?: string } } | null)?.cause?.message ??
				(caught as Error).message ??
				"";
			expect(causeMsg.toLowerCase()).toMatch(/redirect/);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
