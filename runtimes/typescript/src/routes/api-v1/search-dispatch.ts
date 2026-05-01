/**
 * Search dispatcher shared by the vector-store and catalog-scoped
 * document search routes.
 *
 * There are two independent knobs on top of the base vector/text
 * dispatch: **hybrid** (combine lexical + vector) and **rerank**
 * (post-process with a higher-quality signal). Both flags default to
 * the descriptor's `lexical.enabled` / `reranking.enabled` unless the
 * caller explicitly opts in or out.
 *
 * Path selection (mirrors the upsert dispatcher):
 *
 *   1. Caller supplied `vector` → straight to `driver.search`.
 *   2. Caller supplied only `text` and the driver implements
 *      `searchByText` → use the driver-native path (Astra
 *      `$vectorize`, mock provider). No client-side embedder is
 *      built — that path doesn't need a vector handle, and forcing
 *      one breaks `$vectorize` collections whose embedding service
 *      is server-side only (no `secretRef`).
 *   3. Hybrid retrieval needs a vector AND text. If the caller
 *      supplied only text we embed it client-side at this point.
 *   4. Driver throws {@link NotSupportedError} from `searchByText`
 *      → embed client-side and retry through `driver.search`.
 *
 * Rerank without a query text doesn't make sense — if `body.text` is
 * missing and `rerank: true` was explicitly set, we reject with
 * `validation_error`.
 */
import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import {
	NotSupportedError,
	type SearchHit,
} from "../../drivers/vector-store.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import type { Embedder } from "../../embeddings/types.js";
import { ApiError } from "../../lib/errors.js";
import { safeErrorMessage } from "../../lib/safe-error.js";

export interface SearchDispatchBody {
	readonly vector?: readonly number[];
	readonly text?: string;
	readonly topK?: number;
	readonly filter?: Readonly<Record<string, unknown>>;
	readonly includeEmbeddings?: boolean;
	readonly hybrid?: boolean;
	readonly lexicalWeight?: number;
	readonly rerank?: boolean;
}

export interface SearchDispatchArgs {
	readonly ctx: {
		readonly workspace: WorkspaceRecord;
		readonly descriptor: VectorStoreRecord;
	};
	readonly driver: ReturnType<VectorStoreDriverRegistry["for"]>;
	readonly embedders: EmbedderFactory;
	readonly body: SearchDispatchBody;
}

export async function dispatchSearch(
	args: SearchDispatchArgs,
): Promise<readonly SearchHit[]> {
	const { ctx, driver, embedders, body } = args;
	const sharedOpts = {
		topK: body.topK,
		filter: body.filter,
		includeEmbeddings: body.includeEmbeddings,
	};

	// Defaults: descriptor-level config toggles the lanes unless the
	// request says otherwise.
	const hybridRequested = body.hybrid ?? ctx.descriptor.lexical.enabled;
	const rerankRequested = body.rerank ?? ctx.descriptor.reranking.enabled;

	if (body.vector === undefined && body.text === undefined) {
		throw new ApiError(
			"validation_error",
			"exactly one of 'vector' or 'text' is required",
			400,
		);
	}

	// Build-once, use-on-demand client-side embedder. Only paths that
	// genuinely need a vector handle (hybrid retrieval, or fallback when
	// the driver's text path errors out) ever call this. Server-side
	// `$vectorize` collections with no client `secretRef` therefore stay
	// happy — same shape as the ingest dispatcher.
	let cachedEmbedder: Embedder | null = null;
	const embedClientSide = async (text: string): Promise<readonly number[]> => {
		if (!cachedEmbedder) {
			cachedEmbedder = await buildEmbedderOr400(ctx, embedders);
		}
		return cachedEmbedder.embed(text);
	};

	let hits: readonly SearchHit[];

	if (hybridRequested) {
		const text = body.text;
		if (!text) {
			throw new ApiError(
				"validation_error",
				"'hybrid: true' requires 'text' in the request — a lexical lane can't operate on vectors alone",
				400,
			);
		}
		if (!driver.searchHybrid) {
			throw new ApiError(
				"hybrid_not_supported",
				`driver for workspace kind '${ctx.workspace.kind}' does not implement searchHybrid`,
				501,
			);
		}
		const vector = body.vector ?? (await embedClientSide(text));
		try {
			hits = [
				...(await driver.searchHybrid(ctx, {
					vector,
					text,
					lexicalWeight: body.lexicalWeight,
					...sharedOpts,
				})),
			];
		} catch (err) {
			if (err instanceof NotSupportedError) {
				throw new ApiError("hybrid_not_supported", err.message, 501);
			}
			throw err;
		}
	} else if (body.vector !== undefined) {
		hits = [
			...(await driver.search(ctx, { vector: body.vector, ...sharedOpts })),
		];
	} else {
		const text = body.text as string;
		hits = await retrieveFromText({
			ctx,
			driver,
			text,
			sharedOpts,
			embedClientSide,
		});
	}

	if (rerankRequested) {
		if (!body.text) {
			throw new ApiError(
				"validation_error",
				"'rerank' requires 'text' in the request — vectors alone give the reranker nothing to re-score against",
				400,
			);
		}
		if (!driver.rerank) {
			throw new ApiError(
				"rerank_not_supported",
				`driver for workspace kind '${ctx.workspace.kind}' does not implement rerank`,
				501,
			);
		}
		try {
			hits = [
				...(await driver.rerank(ctx, { text: body.text, hits: [...hits] })),
			];
		} catch (err) {
			if (err instanceof NotSupportedError) {
				throw new ApiError("rerank_not_supported", err.message, 501);
			}
			throw err;
		}
	}

	return hits;
}

/**
 * Resolve a text-only query into hits. Prefers the driver's native
 * text-embedding path (Astra `$vectorize`, mock); falls back to
 * client-side embedding only when the driver doesn't implement
 * `searchByText` or surfaces {@link NotSupportedError}.
 */
async function retrieveFromText(opts: {
	readonly ctx: SearchDispatchArgs["ctx"];
	readonly driver: SearchDispatchArgs["driver"];
	readonly text: string;
	readonly sharedOpts: {
		topK?: number;
		filter?: Readonly<Record<string, unknown>>;
		includeEmbeddings?: boolean;
	};
	readonly embedClientSide: (text: string) => Promise<readonly number[]>;
}): Promise<readonly SearchHit[]> {
	const { ctx, driver, text, sharedOpts, embedClientSide } = opts;
	if (driver.searchByText) {
		try {
			return [...(await driver.searchByText(ctx, { text, ...sharedOpts }))];
		} catch (err) {
			if (!(err instanceof NotSupportedError)) throw err;
		}
	}
	const vector = await embedClientSide(text);
	return [...(await driver.search(ctx, { vector, ...sharedOpts }))];
}

async function buildEmbedderOr400(
	ctx: { readonly descriptor: VectorStoreRecord },
	embedders: EmbedderFactory,
): Promise<Embedder> {
	let embedder: Embedder;
	try {
		embedder = await embedders.forConfig(ctx.descriptor.embedding);
	} catch (err) {
		throw new ApiError(
			"embedding_unavailable",
			safeErrorMessage(
				err,
				"embedding provider is not available for this vector store",
			),
			400,
		);
	}
	if (embedder.dimension !== ctx.descriptor.vectorDimension) {
		throw new ApiError(
			"embedding_dimension_mismatch",
			`embedder returned dimension ${embedder.dimension} but vector store expects ${ctx.descriptor.vectorDimension}`,
			400,
		);
	}
	return embedder;
}

/**
 * Shape a driver's readonly hits into the mutable arrays the OpenAPI
 * route response inference expects.
 */
export function toMutableHits(
	hits: Awaited<ReturnType<typeof dispatchSearch>>,
) {
	return hits.map((h) => ({
		id: h.id,
		score: h.score,
		...(h.payload !== undefined && { payload: { ...h.payload } }),
		...(h.vector !== undefined && { vector: [...h.vector] }),
	}));
}
