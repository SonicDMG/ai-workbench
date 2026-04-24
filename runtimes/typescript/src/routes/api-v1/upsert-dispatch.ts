/**
 * Upsert dispatcher shared by the raw vector-store records route and
 * the ingest route.
 *
 * Mirrors {@link ./search-dispatch.dispatchSearch}: one source of truth
 * for the three-path dispatch rule.
 *
 *   1. All records carry `vector` → straight to
 *      {@link VectorStoreDriver.upsert}.
 *   2. All records carry `text` → try
 *      {@link VectorStoreDriver.upsertByText} first (Astra vectorize,
 *      mock provider). On {@link NotSupportedError}, embed every text
 *      record client-side and retry through {@link upsert}.
 *   3. Mixed `text` + `vector` → skip the server-side path entirely
 *      (no transactional way to combine Astra `$vectorize` with
 *      caller-supplied vectors) and embed the text records client-
 *      side before a single {@link upsert}.
 */

import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import { NotSupportedError } from "../../drivers/vector-store.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { ApiError } from "../../lib/errors.js";

export type UpsertDispatchInput = ReadonlyArray<{
	readonly id: string;
	readonly vector?: readonly number[];
	readonly text?: string;
	readonly payload?: Readonly<Record<string, unknown>>;
}>;

export interface UpsertDispatchArgs {
	readonly ctx: {
		readonly workspace: WorkspaceRecord;
		readonly descriptor: VectorStoreRecord;
	};
	readonly driver: ReturnType<VectorStoreDriverRegistry["for"]>;
	readonly embedders: EmbedderFactory;
	readonly records: UpsertDispatchInput;
}

export async function dispatchUpsert(
	args: UpsertDispatchArgs,
): Promise<{ upserted: number }> {
	const { ctx, driver, embedders, records } = args;
	const hasText = records.some((r) => r.text !== undefined);
	const hasVector = records.some((r) => r.vector !== undefined);

	if (!hasText) {
		return driver.upsert(
			ctx,
			records.map((r) => ({
				id: r.id,
				vector: r.vector as readonly number[],
				payload: r.payload,
			})),
		);
	}

	if (!hasVector && driver.upsertByText) {
		try {
			return await driver.upsertByText(
				ctx,
				records.map((r) => ({
					id: r.id,
					text: r.text as string,
					payload: r.payload,
				})),
			);
		} catch (err) {
			if (!(err instanceof NotSupportedError)) throw err;
		}
	}

	const embedder = await buildEmbedderOr400(ctx, embedders);
	const embedded = await Promise.all(
		records.map(async (r) => {
			if (r.vector !== undefined) {
				return { id: r.id, vector: r.vector, payload: r.payload };
			}
			const vector = await embedder.embed(r.text as string);
			return { id: r.id, vector, payload: r.payload };
		}),
	);
	return driver.upsert(ctx, embedded);
}

async function buildEmbedderOr400(
	ctx: { readonly descriptor: VectorStoreRecord },
	embedders: EmbedderFactory,
) {
	try {
		const embedder = await embedders.forConfig(ctx.descriptor.embedding);
		if (embedder.dimension !== ctx.descriptor.vectorDimension) {
			throw new ApiError(
				"embedding_dimension_mismatch",
				`embedder returned dimension ${embedder.dimension} but vector store expects ${ctx.descriptor.vectorDimension}`,
				400,
			);
		}
		return embedder;
	} catch (err) {
		if (err instanceof ApiError) throw err;
		throw new ApiError(
			"embedding_unavailable",
			err instanceof Error
				? err.message
				: "embedding provider is not available for this vector store",
			400,
		);
	}
}
