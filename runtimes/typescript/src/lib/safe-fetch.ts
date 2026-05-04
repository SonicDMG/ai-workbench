/**
 * Outbound-fetch wrapper that disables HTTP redirect following.
 *
 * The endpoint-URL validator in `src/openapi/schemas.ts` blocks
 * cloud-metadata hosts and link-local ranges at config-write time —
 * but a valid public host can return a 30x to `http://169.254.169.254/`
 * and Node's default `fetch` will follow it (up to 20 hops). Setting
 * `redirect: "error"` makes any redirect an outright failure, closing
 * the SSRF redirect-chain bypass against operator-configured
 * embedding / LLM / reranking endpoints.
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

export const safeFetch: typeof fetch = (input, init) => {
	const merged: RequestInit = {
		...(init ?? {}),
		redirect: "error",
	};
	return fetch(input, merged);
};
