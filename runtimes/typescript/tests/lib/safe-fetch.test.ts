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

	test("retries once on a transient SocketError (HTTP/2 GOAWAY shape)", async () => {
		const goaway = Object.assign(new Error('HTTP/2: "GOAWAY" frame received'), {
			name: "SocketError",
		});
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValueOnce(goaway)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const res = await safeFetch("https://example.com/", {
			method: "POST",
			body: JSON.stringify({ hello: "world" }),
		});

		expect(spy).toHaveBeenCalledTimes(2);
		expect(res.status).toBe(200);
	});

	test("retries once on undici ECONNRESET (code on err.cause)", async () => {
		const wrapped = Object.assign(new TypeError("fetch failed"), {
			cause: Object.assign(new Error("read ECONNRESET"), {
				code: "ECONNRESET",
			}),
		});
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValueOnce(wrapped)
			.mockResolvedValueOnce(new Response(null, { status: 200 }));

		await safeFetch("https://example.com/", { method: "POST", body: "x" });

		expect(spy).toHaveBeenCalledTimes(2);
	});

	test("does NOT retry non-transient errors (e.g. ENOTFOUND)", async () => {
		const dnsFail = Object.assign(new Error("getaddrinfo ENOTFOUND foo.bar"), {
			code: "ENOTFOUND",
		});
		const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(dnsFail);

		await expect(
			safeFetch("https://foo.bar/", { method: "POST", body: "x" }),
		).rejects.toBe(dnsFail);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	test("does NOT retry when body is a one-shot ReadableStream", async () => {
		const goaway = Object.assign(new Error("GOAWAY"), { name: "SocketError" });
		const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(goaway);
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("x"));
				controller.close();
			},
		});

		await expect(
			safeFetch("https://example.com/", {
				method: "POST",
				body: stream,
				// Node's fetch requires duplex when sending a stream body.
				duplex: "half",
			}),
		).rejects.toBe(goaway);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	test("propagates a successful first attempt without retry", async () => {
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 200 }));

		await safeFetch("https://example.com/");

		expect(spy).toHaveBeenCalledTimes(1);
	});

	test("only retries once — a second transient failure surfaces", async () => {
		const goaway = Object.assign(new Error("GOAWAY"), { name: "SocketError" });
		const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(goaway);

		await expect(
			safeFetch("https://example.com/", { method: "POST", body: "x" }),
		).rejects.toBe(goaway);
		expect(spy).toHaveBeenCalledTimes(2);
	});
});
