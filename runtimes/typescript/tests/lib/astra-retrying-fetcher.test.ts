import { describe, expect, test, vi } from "vitest";
import {
	type AstraFetcherRequestInfo,
	RetryingAstraFetcher,
} from "../../src/lib/astra-retrying-fetcher.js";

function makeInfo(
	overrides: Partial<AstraFetcherRequestInfo> = {},
): AstraFetcherRequestInfo {
	return {
		url: "https://example.com/api",
		body: JSON.stringify({ ping: 1 }),
		method: "POST",
		headers: { "content-type": "application/json" },
		forceHttp1: false,
		timeout: 5000,
		mkTimeoutError: () =>
			Object.assign(new Error("astra timeout"), { name: "AstraTimeout" }),
		...overrides,
	};
}

function jsonResp(status = 200, body = "{}"): Response {
	return new Response(body, {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("RetryingAstraFetcher", () => {
	test("returns the response shape astra-db-ts expects on success", async () => {
		const stub = vi.fn().mockResolvedValue(jsonResp(200, '{"ok":true}'));
		const fetcher = new RetryingAstraFetcher(stub);

		const out = await fetcher.fetch(makeInfo());

		expect(stub).toHaveBeenCalledTimes(1);
		expect(out.status).toBe(200);
		expect(out.body).toBe('{"ok":true}');
		expect(out.headers["content-type"]).toBe("application/json");
		expect(out.httpVersion).toBe(1);
	});

	test("retries once on a bare SocketError (HTTP/2 GOAWAY shape)", async () => {
		const goaway = Object.assign(new Error('HTTP/2: "GOAWAY" frame received'), {
			name: "SocketError",
		});
		const stub = vi
			.fn()
			.mockRejectedValueOnce(goaway)
			.mockResolvedValueOnce(jsonResp(200, "ok"));
		const fetcher = new RetryingAstraFetcher(stub);

		const out = await fetcher.fetch(makeInfo());

		expect(stub).toHaveBeenCalledTimes(2);
		expect(out.status).toBe(200);
		expect(out.body).toBe("ok");
	});

	test("retries once when undici wraps ECONNRESET as TypeError(cause: ...)", async () => {
		const wrapped = Object.assign(new TypeError("fetch failed"), {
			cause: Object.assign(new Error("read ECONNRESET"), {
				code: "ECONNRESET",
			}),
		});
		const stub = vi
			.fn()
			.mockRejectedValueOnce(wrapped)
			.mockResolvedValueOnce(jsonResp(200, "{}"));
		const fetcher = new RetryingAstraFetcher(stub);

		const out = await fetcher.fetch(makeInfo());

		expect(stub).toHaveBeenCalledTimes(2);
		expect(out.status).toBe(200);
	});

	test("translates TimeoutError into mkTimeoutError() output and does NOT retry", async () => {
		const timeout = Object.assign(new Error("operation timed out"), {
			name: "TimeoutError",
		});
		const stub = vi.fn().mockRejectedValue(timeout);
		const fetcher = new RetryingAstraFetcher(stub);
		const info = makeInfo();

		await expect(fetcher.fetch(info)).rejects.toMatchObject({
			name: "AstraTimeout",
			message: "astra timeout",
		});
		expect(stub).toHaveBeenCalledTimes(1);
	});

	test("unwraps fetch failed and rethrows e.cause on non-transient errors", async () => {
		const realCause = Object.assign(new Error("getaddrinfo ENOTFOUND foo"), {
			code: "ENOTFOUND",
		});
		const wrapped = Object.assign(new TypeError("fetch failed"), {
			cause: realCause,
		});
		const stub = vi.fn().mockRejectedValue(wrapped);
		const fetcher = new RetryingAstraFetcher(stub);

		await expect(fetcher.fetch(makeInfo())).rejects.toBe(realCause);
		expect(stub).toHaveBeenCalledTimes(1);
	});

	test("only retries once — a second transient failure surfaces the second error", async () => {
		const first = Object.assign(new Error("GOAWAY 1"), { name: "SocketError" });
		const second = Object.assign(new Error("GOAWAY 2"), {
			name: "SocketError",
		});
		const stub = vi
			.fn()
			.mockRejectedValueOnce(first)
			.mockRejectedValueOnce(second);
		const fetcher = new RetryingAstraFetcher(stub);

		await expect(fetcher.fetch(makeInfo())).rejects.toBe(second);
		expect(stub).toHaveBeenCalledTimes(2);
	});

	test("passes through method, headers, and body to the underlying fetch", async () => {
		const stub = vi.fn().mockResolvedValue(jsonResp(200, "{}"));
		const fetcher = new RetryingAstraFetcher(stub);

		await fetcher.fetch(
			makeInfo({
				method: "DELETE",
				headers: {
					authorization: "Bearer xyz",
					"content-type": "application/json",
				},
				body: '{"delete":true}',
			}),
		);

		const [url, init] = stub.mock.calls[0] ?? [];
		expect(url).toBe("https://example.com/api");
		expect((init as RequestInit).method).toBe("DELETE");
		expect((init as RequestInit).body).toBe('{"delete":true}');
		const headers = (init as RequestInit).headers as Record<string, string>;
		expect(headers.authorization).toBe("Bearer xyz");
	});
});
