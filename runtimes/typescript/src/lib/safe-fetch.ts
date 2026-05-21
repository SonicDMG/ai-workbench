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
 * One bounded retry on the transient-error set defined in
 * {@link ../lib/net-retry.ts} — see that file for the rationale. The
 * retry runs only when the body is replayable (no consumed streams)
 * and the caller's `AbortSignal` hasn't fired during backoff.
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

import {
	backoffMs,
	isReplayableBody,
	isTransientNetError,
	sleep,
} from "./net-retry.js";

function isAborted(signal: AbortSignal | null | undefined): boolean {
	return signal?.aborted === true;
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
