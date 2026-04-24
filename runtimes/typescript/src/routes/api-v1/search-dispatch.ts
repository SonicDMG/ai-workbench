/**
 * Search dispatcher shared by the vector-store and catalog-scoped
 * document search routes.
 *
 * The three-path dispatch model lives here so the two callers agree
 * exactly on which driver method runs for which inputs:
 *
 *   1. `body.vector`  → straight through to {@link VectorStoreDriver.search}.
 *   2. `body.text` + driver.searchByText present + doesn't throw
 *      {@link NotSupportedError} → server-side embedding (Astra `$vectorize`
 *      or mock equivalent).
 *   3. `body.text` → client-side embedding via the descriptor's
 *      `embedding` config, then a vector search.
 */
import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import { NotSupportedError } from "../../drivers/vector-store.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { ApiError } from "../../lib/errors.js";

export interface SearchDispatchBody {
	readonly vector?: readonly number[];
	readonly text?: string;
	readonly topK?: number;
	readonly filter?: Readonly<Record<string, unknown>>;
	readonly includeEmbeddings?: boolean;
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

export async function dispatchSearch(args: SearchDispatchArgs) {
	const { ctx, driver, embedders, body } = args;
	const sharedOpts = {
		topK: body.topK,
		filter: body.filter,
		includeEmbeddings: body.includeEmbeddings,
	};

	if (body.vector !== undefined) {
		return driver.search(ctx, { vector: body.vector, ...sharedOpts });
	}

	const text = body.text;
	if (text === undefined) {
		// Zod refinement already rejects this; the extra guard satisfies
		// the type narrower below.
		throw new ApiError(
			"validation_error",
			"exactly one of 'vector' or 'text' is required",
			400,
		);
	}

	if (driver.searchByText) {
		try {
			return await driver.searchByText(ctx, { text, ...sharedOpts });
		} catch (err) {
			if (!(err instanceof NotSupportedError)) throw err;
		}
	}

	let embedder: Awaited<ReturnType<EmbedderFactory["forConfig"]>>;
	try {
		embedder = await embedders.forConfig(ctx.descriptor.embedding);
	} catch (err) {
		throw new ApiError(
			"embedding_unavailable",
			err instanceof Error
				? err.message
				: "embedding provider is not available for this vector store",
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
	const vector = await embedder.embed(text);
	return driver.search(ctx, { vector, ...sharedOpts });
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
