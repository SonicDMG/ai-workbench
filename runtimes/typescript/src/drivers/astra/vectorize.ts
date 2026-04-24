/**
 * Map a {@link EmbeddingConfig} onto Astra's {@link VectorizeServiceOptions}.
 *
 * Astra's Data API can do server-side embedding ("vectorize") when a
 * collection is created with a `vector.service` block. When the
 * descriptor's `embedding` declares a provider we know Astra supports,
 * we opt into that path at `createCollection` time; subsequent
 * `insertOne({ $vectorize })` / `find(sort: { $vectorize })` calls
 * have Astra run the embedding itself, so the runtime's playground
 * never has to hand the embedding API key to OpenAI/Cohere/etc.
 *
 * Auth for the upstream provider is attached **per-request** via the
 * `embeddingApiKey` header on each collection call (resolved from the
 * descriptor's `secretRef` at call time). That keeps the Astra-KMS
 * provisioning (shared-secret-by-name) out of scope for now; operators
 * who prefer KMS can set `authentication.providerKey` manually later.
 *
 * The allowlist is intentionally short — every entry is a
 * provider/model combination we've validated works end-to-end. Adding
 * another provider is a one-line change + a round of testing.
 */

import type { EmbeddingConfig } from "../../control-plane/types.js";

/** Shape accepted by `db.createCollection`'s `vector.service`. */
export interface VectorizeService {
	readonly provider: string;
	readonly modelName: string;
	readonly parameters?: Readonly<Record<string, unknown>>;
}

/**
 * Returns the `service` config when this embedding declaration is one
 * Astra vectorize supports, else null. The descriptor must also carry
 * a `secretRef` — without an API key, the request-time header won't be
 * set and Astra will reject the $vectorize call.
 */
export function resolveVectorizeService(
	config: EmbeddingConfig,
): VectorizeService | null {
	if (!config.secretRef) return null;
	if (!SUPPORTED_PROVIDERS.has(config.provider)) return null;
	return {
		provider: config.provider,
		modelName: config.model,
	};
}

/**
 * Providers the Astra Data API's vectorize service accepts today.
 * The official list is longer (huggingfaceDedicated, upstageAI, …);
 * add entries here once we've smoke-tested them end-to-end.
 */
const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set([
	"openai",
	"azureOpenAI",
	"cohere",
	"jinaAI",
	"mistral",
	"nvidia",
	"voyageAI",
]);

/**
 * Heuristic for "Astra rejected the call because this collection
 * wasn't created with a `service` block". Used by the driver to
 * translate into {@link NotSupportedError} so the route layer falls
 * back to client-side embedding.
 *
 * The Data API surfaces this as error code `COLLECTION_VECTORIZE_NOT_CONFIGURED`
 * in some paths and as a generic "service not configured" message in
 * others, so we match on both signals defensively.
 */
export function isVectorizeNotConfigured(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const asObj = err as Record<string, unknown>;
	const code =
		typeof asObj.errorCode === "string"
			? asObj.errorCode
			: typeof asObj.code === "string"
				? asObj.code
				: null;
	if (code && /VECTORIZE/i.test(code)) return true;
	const message =
		typeof asObj.message === "string" ? asObj.message.toLowerCase() : "";
	if (
		/\$vectorize/.test(message) &&
		/not (configured|supported|available)/.test(message)
	) {
		return true;
	}
	if (
		/vectorize.*service/.test(message) &&
		/not (configured|available)/.test(message)
	) {
		return true;
	}
	return false;
}
