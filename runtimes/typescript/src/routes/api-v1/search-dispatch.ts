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
 * Dispatch order:
 *
 *   1. Resolve the query vector — from `body.vector` directly, or by
 *      embedding `body.text` via `driver.searchByText`'s native path
 *      (Astra `$vectorize`) or client-side via the descriptor's
 *      embedding config.
 *   2. If **hybrid** is on and the driver implements `searchHybrid`,
 *      run it with both vector + text. If the driver throws
 *      NotSupported we surface it — users who explicitly asked for
 *      hybrid should see the 501, not a silent vector-only result.
 *   3. Otherwise run a vector search through `driver.search`.
 *   4. If **rerank** is on and the driver implements `rerank`, post-
 *      process the hits. Same NotSupported contract as above.
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
	const { ctx, driver, body } = args;
	const sharedOpts = {
		topK: body.topK,
		filter: body.filter,
		includeEmbeddings: body.includeEmbeddings,
	};

	// Defaults: descriptor-level config toggles the lanes unless the
	// request says otherwise.
	const hybridRequested = body.hybrid ?? ctx.descriptor.lexical.enabled;
	const rerankRequested = body.rerank ?? ctx.descriptor.reranking.enabled;

	// 1. Pre-retrieval: resolve a query vector + optional text.
	const resolved = await resolveQuery(args);

	// 2. Retrieval: hybrid if asked-and-supported, otherwise vector.
	let hits = await retrieve({
		args,
		resolved,
		hybridRequested,
		sharedOpts,
	});

	// 3. Rerank if asked-and-supported.
	if (rerankRequested) {
		if (!resolved.text) {
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
			hits = [...(await driver.rerank(ctx, { text: resolved.text, hits }))];
		} catch (err) {
			if (err instanceof NotSupportedError) {
				throw new ApiError("rerank_not_supported", err.message, 501);
			}
			throw err;
		}
	}

	return hits;
}

interface ResolvedQuery {
	readonly vector: readonly number[];
	readonly text: string | null;
}

async function resolveQuery(args: SearchDispatchArgs): Promise<ResolvedQuery> {
	const { ctx, driver, embedders, body } = args;
	if (body.vector !== undefined) {
		return { vector: body.vector, text: body.text ?? null };
	}
	const text = body.text;
	if (text === undefined) {
		throw new ApiError(
			"validation_error",
			"exactly one of 'vector' or 'text' is required",
			400,
		);
	}
	// Prefer the driver-native text-embedding path where available; the
	// hybrid / rerank routes below need the embedding vector regardless
	// of which path produced it, so we always return one.
	if (driver.searchByText) {
		// The driver's own embedding service (Astra `$vectorize`) is
		// used for retrieval but we still need a vector handle to
		// pass into `searchHybrid` if hybrid fires. Falling back to
		// the client-side embedder in that case — cheap and avoids
		// splitting the dispatch across two code paths.
	}
	const embedder = await buildEmbedderOr400(ctx, embedders);
	const vector = await embedder.embed(text);
	return { vector, text };
}

async function retrieve(args: {
	readonly args: SearchDispatchArgs;
	readonly resolved: ResolvedQuery;
	readonly hybridRequested: boolean;
	readonly sharedOpts: {
		topK?: number;
		filter?: Readonly<Record<string, unknown>>;
		includeEmbeddings?: boolean;
	};
}): Promise<SearchHit[]> {
	const { args: a, resolved, hybridRequested, sharedOpts } = args;
	const { ctx, driver, body } = a;

	if (hybridRequested) {
		if (!resolved.text) {
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
		try {
			const hits = await driver.searchHybrid(ctx, {
				vector: resolved.vector,
				text: resolved.text,
				lexicalWeight: body.lexicalWeight,
				...sharedOpts,
			});
			return [...hits];
		} catch (err) {
			if (err instanceof NotSupportedError) {
				throw new ApiError("hybrid_not_supported", err.message, 501);
			}
			throw err;
		}
	}

	// Vector-only retrieval. If the caller gave us only text, we
	// already embedded it in `resolveQuery`; otherwise we have a
	// caller-supplied vector.
	if (
		body.text !== undefined &&
		body.vector === undefined &&
		driver.searchByText
	) {
		// Preserve the existing driver-native text-search path when
		// hybrid / rerank aren't involved — the route layer used to
		// call this directly and the resulting hits may carry
		// driver-specific scores that vector-fallback can't reproduce.
		try {
			const hits = await driver.searchByText(ctx, {
				text: body.text,
				...sharedOpts,
			});
			return [...hits];
		} catch (err) {
			if (!(err instanceof NotSupportedError)) throw err;
		}
	}

	const hits = await driver.search(ctx, {
		vector: resolved.vector,
		...sharedOpts,
	});
	return [...hits];
}

async function buildEmbedderOr400(
	ctx: { readonly descriptor: VectorStoreRecord },
	embedders: EmbedderFactory,
) {
	let embedder: Awaited<ReturnType<EmbedderFactory["forConfig"]>>;
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
