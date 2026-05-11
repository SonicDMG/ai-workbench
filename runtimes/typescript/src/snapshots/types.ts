/**
 * Discriminated union describing a single Astra Data API call the
 * runtime made (or is about to make) on a user's behalf. The SPA
 * renders these into runnable client-code snippets (TS / Python /
 * Java / cURL) so the user can copy the same call and execute it
 * themselves against the same database.
 *
 * **Capture contract.** Snapshots are emitted only for Astra-kind
 * workspaces (`kind: "astra" | "hcd"`). Mock and file-backed
 * workspaces don't have a Data API call to render, so the affordance
 * stays hidden there.
 *
 * **What is *not* captured.** Tokens, endpoint URLs, and the raw
 * vector payloads on writes. The generated snippets reference
 * `$ASTRA_DB_*` env vars for credentials; users fill those in
 * locally. Vectors aren't useful as copy-paste examples (they're
 * provider-specific and huge) — the snippets show the `$vectorize`
 * server-side embedding shape instead, which is what the runtime
 * actually uses when an embedding service is bound.
 *
 * **Schema versioning.** Adding a new kind is additive — older
 * clients that don't know the kind drop the snapshot in the parser.
 * Adding a required field to an existing kind is breaking; bump the
 * SPA parser too. Removing a kind is breaking.
 *
 * History:
 *   - `vector_search`, `list_chunks` shipped in the chat code-view
 *     affordance (commit b8ee2bb era). Legacy persisted rows from
 *     before the discriminator existed had no `kind` field and
 *     matched `vector_search` exactly — the SPA parser still falls
 *     back to that.
 *   - `create_collection`, `insert_chunks`, `delete_by_document`,
 *     `delete_chunk` shipped in the "code-view everywhere" rollout
 *     (this PR) to cover KB-create, ingest, and document-delete
 *     surfaces.
 */

interface AstraQuerySnapshotBase {
	readonly knowledgeBaseId: string;
	readonly kbName: string;
	/** Astra Data API collection name (the actual table). */
	readonly collection: string;
	readonly keyspace: string | null;
}

/* ---------------- read shapes ---------------- */

/**
 * Server-side-embedded vector search — what `search_kb` runs during
 * chat retrieval and what the playground search button runs. A
 * `find` with `$vectorize` sort and a top-K limit.
 */
export interface AstraVectorSearchSnapshot extends AstraQuerySnapshotBase {
	readonly kind: "vector_search";
	readonly query: {
		readonly text: string;
		readonly topK: number;
	};
}

/**
 * Positional document-scoped read — what `list_chunks` runs. A
 * `find` filtered by `documentId`, sorted by `chunkIndex`, with
 * limit + skip for paging. No vector math.
 */
export interface AstraListChunksSnapshot extends AstraQuerySnapshotBase {
	readonly kind: "list_chunks";
	readonly query: {
		readonly documentId: string;
		readonly limit: number;
		readonly offset: number;
	};
}

/* ---------------- write shapes ---------------- */

/**
 * Collection creation — what KB-create runs against the data plane
 * when the workbench owns the underlying collection. The snippets
 * use `db.createCollection(name, { vector: { dimension, metric,
 * service }, lexical, rerank })`.
 *
 * `vectorize` mirrors the `service` block Astra accepts on the
 * vector options; absent when the descriptor doesn't bind an
 * embedding service the runtime knows how to vectorize on the
 * server side. `lexical` / `rerank` mirror the descriptor toggles —
 * the generator only emits them when enabled.
 */
export interface AstraCreateCollectionSnapshot extends AstraQuerySnapshotBase {
	readonly kind: "create_collection";
	readonly options: {
		readonly vectorDimension: number;
		readonly vectorMetric: "cosine" | "dot_product" | "euclidean";
		readonly vectorize: {
			readonly provider: string;
			readonly modelName: string;
		} | null;
		readonly lexical: {
			readonly enabled: true;
			readonly analyzer: string;
		} | null;
		readonly rerank: {
			readonly enabled: true;
			readonly provider: string;
			readonly modelName: string;
		} | null;
	};
}

/**
 * Chunk batch insertion — what the ingest pipeline runs once per
 * chunk batch when the collection has a server-side vectorize
 * service bound. The snippet shows `coll.insertMany(docs)` with
 * `$vectorize` set on each doc.
 *
 * `batchSize` is the count of chunks in the representative call. The
 * actual pipeline may run several `insertMany` calls of this shape
 * for a single document — the UI surfaces a footer line noting the
 * call is repeated rather than enumerating every batch.
 *
 * `documentId` scopes the example payload so the user can see how
 * `$vectorize` + the document-id + chunk-index payload keys travel
 * together. Vectors are NOT captured — the snippet reads
 * placeholders for the chunk text instead so it remains runnable.
 */
export interface AstraInsertChunksSnapshot extends AstraQuerySnapshotBase {
	readonly kind: "insert_chunks";
	readonly batch: {
		readonly documentId: string;
		readonly batchSize: number;
	};
}

/**
 * Bulk delete of every chunk that belongs to a given document —
 * what the document-cascade runs on delete. Snippet shows
 * `coll.deleteMany({ documentId, knowledgeBaseId })` using the
 * payload keys ingest stamps onto every chunk.
 */
export interface AstraDeleteByDocumentSnapshot extends AstraQuerySnapshotBase {
	readonly kind: "delete_by_document";
	readonly filter: {
		readonly documentId: string;
	};
}

/**
 * Single-chunk delete by `_id` — fallback used by drivers without
 * `deleteMany`, and by surfaces that drop one chunk at a time.
 * Snippet shows `coll.deleteOne({ _id: chunkId })`.
 */
export interface AstraDeleteChunkSnapshot extends AstraQuerySnapshotBase {
	readonly kind: "delete_chunk";
	readonly filter: {
		readonly chunkId: string;
	};
}

export type AstraQuerySnapshot =
	| AstraVectorSearchSnapshot
	| AstraListChunksSnapshot
	| AstraCreateCollectionSnapshot
	| AstraInsertChunksSnapshot
	| AstraDeleteByDocumentSnapshot
	| AstraDeleteChunkSnapshot;

/* ---------------- builder helpers ---------------- */

/**
 * Common factory shape — every builder takes the KB-identifying
 * envelope plus the call-specific payload. Pulled into a helper so
 * the four service-side capture sites read identically.
 */
interface SnapshotEnvelope {
	readonly knowledgeBaseId: string;
	readonly kbName: string;
	readonly collection: string;
	readonly keyspace: string | null;
}

export function buildVectorSearchSnapshot(args: {
	readonly envelope: SnapshotEnvelope;
	readonly text: string;
	readonly topK: number;
}): AstraVectorSearchSnapshot {
	return {
		kind: "vector_search",
		...args.envelope,
		query: { text: args.text, topK: args.topK },
	};
}

export function buildListChunksSnapshot(args: {
	readonly envelope: SnapshotEnvelope;
	readonly documentId: string;
	readonly limit: number;
	readonly offset: number;
}): AstraListChunksSnapshot {
	return {
		kind: "list_chunks",
		...args.envelope,
		query: {
			documentId: args.documentId,
			limit: args.limit,
			offset: args.offset,
		},
	};
}

export function buildCreateCollectionSnapshot(args: {
	readonly envelope: SnapshotEnvelope;
	readonly vectorDimension: number;
	readonly vectorMetric: "cosine" | "dot_product" | "euclidean";
	readonly vectorize: {
		readonly provider: string;
		readonly modelName: string;
	} | null;
	readonly lexical: {
		readonly enabled: true;
		readonly analyzer: string;
	} | null;
	readonly rerank: {
		readonly enabled: true;
		readonly provider: string;
		readonly modelName: string;
	} | null;
}): AstraCreateCollectionSnapshot {
	return {
		kind: "create_collection",
		...args.envelope,
		options: {
			vectorDimension: args.vectorDimension,
			vectorMetric: args.vectorMetric,
			vectorize: args.vectorize,
			lexical: args.lexical,
			rerank: args.rerank,
		},
	};
}

export function buildInsertChunksSnapshot(args: {
	readonly envelope: SnapshotEnvelope;
	readonly documentId: string;
	readonly batchSize: number;
}): AstraInsertChunksSnapshot {
	return {
		kind: "insert_chunks",
		...args.envelope,
		batch: { documentId: args.documentId, batchSize: args.batchSize },
	};
}

export function buildDeleteByDocumentSnapshot(args: {
	readonly envelope: SnapshotEnvelope;
	readonly documentId: string;
}): AstraDeleteByDocumentSnapshot {
	return {
		kind: "delete_by_document",
		...args.envelope,
		filter: { documentId: args.documentId },
	};
}

export function buildDeleteChunkSnapshot(args: {
	readonly envelope: SnapshotEnvelope;
	readonly chunkId: string;
}): AstraDeleteChunkSnapshot {
	return {
		kind: "delete_chunk",
		...args.envelope,
		filter: { chunkId: args.chunkId },
	};
}
