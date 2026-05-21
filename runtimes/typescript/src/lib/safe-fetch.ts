/**
 * Outbound-fetch wrapper that disables HTTP redirect following and
 * retries once on transient network errors.
 *
 * ## Redirect blocking
 *
 * The endpoint-URL validator in `src/openapi/schemas.ts` blocks
 * cloud-metadata hosts and link-local ranges at config-write time —
 * but a valid public host can return a 30x to `http://169.254.169.254/`
 * and Node's default `fetch` will follow it (up to 20 hops). Setting
 * `redirect: "error"` makes any redirect an outright failure, closing
 * the SSRF redirect-chain bypass against operator-configured
 * embedding / LLM / reranking endpoints.
 *
 * ## Transient-error retry
 *
 * Upstream services (OpenAI, embedding providers) sit behind load
 * balancers that rotate HTTP/2 connections periodically — every N
 * requests or every few minutes — by sending a `GOAWAY` frame with
 * code 0 (NO_ERROR). undici surfaces that as a `SocketError` that
 * bubbles out of the in-flight request as an unhandled error, even
 * though the server is signalling a *graceful* shutdown and a fresh
 * connection would succeed. The same pattern applies to `ECONNRESET`,
 * `EPIPE`, and undici's timeout codes — all transient.
 *
 * One bounded retry on a fresh connection clears 99% of these. The
 * retry runs only when:
 *   - the error matches the transient set ({@link isTransientNetError}),
 *   - the body isn't a one-shot stream that's already been consumed
 *     (see {@link isReplayableBody}),
 *   - the caller's `AbortSignal` hasn't been aborted in the meantime.
 *
 * undici's connection pool drops the broken connection on the failed
 * attempt, so the retry naturally opens a new one — no agent surgery
 * required.
 *
 * Usage: pass this in place of the global `fetch` whenever the request
 * target was derived from operator config. The OpenAI SDK accepts a
 * `fetch` override on `configuration`; the OpenAIChatService here uses
 * it as the default `fetchImpl`. SDKs that don't expose a fetch hook
 * (currently `@huggingface/inference`, `@langchain/cohere`) rely on
 * the URL validator alone — the redirect risk for those vendors is
 * lower because the base URL is hardcoded by the SDK, not operator-
 * supplied.
 */

/**
 * undici / Node error codes treated as transient for retry purposes.
 *
 * Conspicuously absent: `ENOTFOUND` (persistent DNS failure) and
 * `UND_ERR_INVALID_ARG` (programmer error). `EAI_AGAIN` *is* in the
 * set because it's the DNS resolver's explicit "try again later"
 * signal.
 */
const TRANSIENT_CODES = new Set([
	"UND_ERR_SOCKET",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_BODY_TIMEOUT",
	"ECONNRESET",
	"EPIPE",
	"ETIMEDOUT",
	"EAI_AGAIN",
]);

function errCode(e: unknown): string | undefined {
	if (e && typeof e === "object" && "code" in e) {
		const code = (e as { code?: unknown }).code;
		return typeof code === "string" ? code : undefined;
	}
	return undefined;
}

function errName(e: unknown): string | undefined {
	return e instanceof Error ? e.name : undefined;
}

/**
 * `fetch failed` wraps the real undici error as `cause`. The HTTP/2
 * GOAWAY path we see in the wild surfaces a bare `SocketError` from
 * an event emitter without going through that wrapping — so we check
 * both the outer error and its cause.
 */
function isTransientNetError(err: unknown): boolean {
	const candidates: unknown[] = [err];
	if (err && typeof err === "object" && "cause" in err) {
		candidates.push((err as { cause?: unknown }).cause);
	}
	for (const c of candidates) {
		if (errName(c) === "SocketError") return true;
		const code = errCode(c);
		if (code && TRANSIENT_CODES.has(code)) return true;
	}
	return false;
}

/**
 * A request body is replayable if calling `fetch` a second time with
 * the same `init` will resend identical bytes. Strings, ArrayBuffers,
 * Blobs, URLSearchParams, and FormData all qualify — each call
 * re-reads the source. `ReadableStream` does NOT: it's consumed by
 * the first attempt and a retry would send an empty body. We bail
 * out of the retry in that case rather than silently corrupting the
 * request.
 */
function isReplayableBody(body: BodyInit | null | undefined): boolean {
	if (body === null || body === undefined) return true;
	if (typeof body === "string") return true;
	if (body instanceof ArrayBuffer) return true;
	if (ArrayBuffer.isView(body)) return true;
	if (typeof Blob !== "undefined" && body instanceof Blob) return true;
	if (
		typeof URLSearchParams !== "undefined" &&
		body instanceof URLSearchParams
	) {
		return true;
	}
	if (typeof FormData !== "undefined" && body instanceof FormData) return true;
	return false;
}

function isAborted(signal: AbortSignal | null | undefined): boolean {
	return signal?.aborted === true;
}

/**
 * Small jittered backoff between the failed attempt and the retry.
 * Keeps simultaneous-retry storms from synchronizing across callers
 * if many requests fail at the same instant (e.g. an LB rolling all
 * connections at once).
 */
function backoffMs(): number {
	return 50 + Math.floor(Math.random() * 100);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new DOMException("Aborted", "AbortError"));
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export const safeFetch: typeof fetch = async (input, init) => {
	const merged: RequestInit = {
		...(init ?? {}),
		redirect: "error",
	};
	const signal = merged.signal ?? null;
	const canRetry = isReplayableBody(merged.body ?? null);

	try {
		return await fetch(input, merged);
	} catch (err) {
		if (!canRetry) throw err;
		if (!isTransientNetError(err)) throw err;
		if (isAborted(signal)) throw err;
		try {
			await sleep(backoffMs(), signal);
		} catch {
			// Caller aborted during backoff — surface the original error,
			// not the abort.
			throw err;
		}
		return await fetch(input, merged);
	}
};
