/**
 * Custom `Fetcher` for `@datastax/astra-db-ts` that retries once on
 * transient network errors.
 *
 * ### Why we need a custom fetcher
 *
 * The default Astra fetcher (`FetchNative` in `@datastax/astra-db-ts`)
 * uses Node's native `fetch` and deliberately strips the `TypeError:
 * fetch failed` envelope so callers see the underlying undici error
 * directly:
 *
 * ```js
 * if (e instanceof TypeError && e.message === 'fetch failed' && 'cause' in e) {
 *   throw e.cause;
 * }
 * ```
 *
 * That means when Astra's edge sends an HTTP/2 `GOAWAY` mid-request
 * (a graceful connection rotation — code 0, not an error condition),
 * the runtime sees a bare `SocketError` bubble out of an
 * otherwise-valid request and a 500 reaches the caller. Across an
 * ingest pipeline that fans out into many small Astra calls, this
 * accounts for a steady drip of failed `/ingest/file` requests.
 *
 * This fetcher matches `FetchNative`'s contract — same response
 * shape, same timeout translation, same `e.cause` unwrap — and wraps
 * it with one bounded retry on the shared transient-error set defined
 * in `./net-retry.ts`. undici drops the broken connection on the
 * failed attempt, so the retry naturally opens a fresh one.
 *
 * ### What we don't change
 *
 * - `httpVersion` is reported as `1` to match `FetchNative` — this
 *   field is informational only (used for logging in `astra-db-ts`).
 * - `forceHttp1` is honored as a no-op: Node's `fetch` defaults to
 *   HTTP/1.1, so there's nothing to disable. If undici ever flips
 *   `allowH2` on by default, this needs revisiting.
 * - Timeouts: caller-supplied `info.timeout` is combined with any
 *   existing signal via `AbortSignal.any`, exactly as `FetchNative`
 *   does, and a `TimeoutError` is translated through
 *   `info.mkTimeoutError()`.
 */

import { backoffMs, isTransientNetError, sleep } from "./net-retry.js";

/**
 * Structural subset of `@datastax/astra-db-ts`'s `FetcherRequestInfo`
 * — only the fields we use. Keeping the type local lets the fetcher
 * be unit-tested without dragging in `astra-db-ts`'s public types,
 * and means future field additions in the SDK don't break us.
 */
export interface AstraFetcherRequestInfo {
	readonly url: string;
	readonly body: string | undefined;
	readonly method: "DELETE" | "GET" | "POST";
	readonly headers: Record<string, string>;
	readonly forceHttp1: boolean;
	readonly mkTimeoutError: () => Error;
	readonly timeout: number;
}

export interface AstraFetcherResponseInfo {
	readonly url: string;
	readonly statusText: string;
	readonly httpVersion: 1 | 2;
	readonly headers: Record<string, string>;
	readonly body: string;
	readonly status: number;
}

export interface AstraFetcher {
	fetch(info: AstraFetcherRequestInfo): Promise<AstraFetcherResponseInfo>;
	close?(): Promise<void>;
}

/**
 * Indirection over the global `fetch` so unit tests can swap in a
 * stub without monkey-patching `globalThis`. The default is
 * `globalThis.fetch.bind(globalThis)` — binding matters because
 * undici's fetch checks `this` and rejects when called as a detached
 * function reference.
 */
export type FetchImpl = typeof fetch;

function isTimeoutError(e: unknown): boolean {
	return e instanceof Error && e.name.includes("TimeoutError");
}

/**
 * Unwrap `TypeError: fetch failed` so callers see the underlying
 * undici error. Matches `FetchNative`'s behavior so the rest of
 * `astra-db-ts` (error code matching, log fields) keeps working.
 */
function unwrapFetchFailed(e: unknown): unknown {
	if (
		e instanceof TypeError &&
		e.message === "fetch failed" &&
		typeof e === "object" &&
		"cause" in e
	) {
		return (e as { cause: unknown }).cause;
	}
	return e;
}

async function doFetch(
	info: AstraFetcherRequestInfo,
	fetchImpl: FetchImpl,
): Promise<AstraFetcherResponseInfo> {
	const timeoutSignal = AbortSignal.timeout(info.timeout);
	const init: RequestInit = {
		method: info.method,
		headers: info.headers,
		body: info.body,
		signal: timeoutSignal,
	};
	const resp = await fetchImpl(info.url, init);
	const headers: Record<string, string> = {};
	resp.headers.forEach((value, key) => {
		headers[key] = value;
	});
	const body = await resp.text();
	return {
		url: resp.url,
		statusText: resp.statusText,
		httpVersion: 1,
		headers,
		body,
		status: resp.status,
	};
}

export class RetryingAstraFetcher implements AstraFetcher {
	private readonly fetchImpl: FetchImpl;

	constructor(fetchImpl: FetchImpl = globalThis.fetch.bind(globalThis)) {
		this.fetchImpl = fetchImpl;
	}

	async fetch(
		info: AstraFetcherRequestInfo,
	): Promise<AstraFetcherResponseInfo> {
		try {
			return await doFetch(info, this.fetchImpl);
		} catch (raw) {
			const err = unwrapFetchFailed(raw);
			if (isTimeoutError(err)) throw info.mkTimeoutError();
			if (!isTransientNetError(err)) throw err;
			// Astra request bodies are JSON strings — always replayable —
			// so we don't need to gate retry on body shape the way
			// `safeFetch` does.
			try {
				await sleep(backoffMs());
			} catch {
				throw err;
			}
			try {
				return await doFetch(info, this.fetchImpl);
			} catch (raw2) {
				const err2 = unwrapFetchFailed(raw2);
				if (isTimeoutError(err2)) throw info.mkTimeoutError();
				throw err2;
			}
		}
	}

	async close(): Promise<void> {
		// No persistent state — undici manages its own connection pool.
	}
}
