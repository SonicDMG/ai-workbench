/**
 * Shared primitives for "retry once on transient network errors."
 *
 * Used by both {@link safeFetch} (operator-configured LLM / embedding
 * endpoints) and the Astra {@link RetryingFetcher} (control-plane
 * data calls). The two layers can't share a single wrapper because
 * they enforce different surrounding behaviors — `safeFetch` blocks
 * redirects, the Astra fetcher must honor `forceHttp1` and translate
 * timeouts into `info.mkTimeoutError()` per the `Fetcher` contract —
 * but the *what counts as transient* and *what's safe to replay*
 * decisions are identical and centralised here.
 *
 * ### Why a retry is needed at all
 *
 * Upstream services sit behind load balancers (Vercel, AWS ALB,
 * Cloudflare, Astra's edge) that rotate HTTP/2 connections every N
 * requests or every few minutes by sending a `GOAWAY` frame with
 * code 0 (NO_ERROR). undici surfaces that as a `SocketError` that
 * bubbles out of the in-flight request even though the server is
 * signalling a *graceful* shutdown. `ECONNRESET` / `EPIPE` /
 * undici timeouts have the same not-actually-broken character. One
 * bounded retry on a fresh connection clears the vast majority of
 * these — undici drops the broken connection from its pool on the
 * failed attempt, so the retry naturally opens a new one with no
 * agent surgery.
 */

/**
 * undici / Node error codes treated as transient.
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
 * GOAWAY path also surfaces a bare `SocketError` from a session-level
 * event without that wrapping (and `astra-db-ts`'s `FetchNative`
 * deliberately strips the wrapper to re-throw `e.cause`), so we check
 * both the outer error and its cause.
 */
export function isTransientNetError(err: unknown): boolean {
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
 * A request body is replayable if calling the underlying transport
 * a second time with the same payload will resend identical bytes.
 * Strings, ArrayBuffers, Blobs, URLSearchParams, and FormData all
 * qualify — each call re-reads the source. `ReadableStream` does
 * NOT: it's consumed by the first attempt and a retry would send an
 * empty body. The retry path must bail in that case rather than
 * silently corrupting the request.
 */
export function isReplayableBody(body: unknown): boolean {
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

/**
 * Small jittered backoff between the failed attempt and the retry.
 * Keeps simultaneous-retry storms from synchronizing across callers
 * if many requests fail at the same instant (e.g. an LB rolling all
 * connections at once).
 */
export function backoffMs(): number {
	return 50 + Math.floor(Math.random() * 100);
}

export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
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
