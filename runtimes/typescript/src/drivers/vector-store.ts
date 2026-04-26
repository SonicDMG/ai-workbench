/**
 * Vector-store driver contract.
 *
 * Responsible for **data-plane** operations against a workspace's
 * backing store — provisioning the collection, upserting records,
 * deleting, and searching. Separate from the **control-plane**
 * `ControlPlaneStore` (which only manages descriptors / metadata).
 *
 * Every backend that can hold vectors implements this interface:
 *   - {@link ./mock/store.MockVectorStoreDriver} — in-memory, for CI
 *     and workspaces with `kind: "mock"`.
 *   - {@link ./astra/store.AstraVectorStoreDriver} — Astra Data API
 *     Collections, for workspaces with `kind: "astra"`.
 *   - `hcd` and `openrag` drivers are reserved but not shipped.
 *
 * The driver receives the relevant {@link WorkspaceRecord} and
 * {@link VectorStoreRecord} on every call — no per-workspace state
 * is held at the driver interface level. Concrete implementations
 * may cache per-workspace resources internally (e.g. DataAPIClient
 * instances for Astra).
 */

import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../control-plane/types.js";

/** Context passed to every driver method. */
export interface VectorStoreDriverContext {
	readonly workspace: WorkspaceRecord;
	readonly descriptor: VectorStoreRecord;
}

/** A record to upsert — id + embedding + optional payload. */
export interface VectorRecord {
	readonly id: string;
	readonly vector: readonly number[];
	readonly payload?: Readonly<Record<string, unknown>>;
}

/** A text-valued record that the backend is expected to embed itself
 * (Astra `$vectorize`) or that the route layer will embed client-side
 * before handing to {@link VectorStoreDriver.upsert} when the driver
 * can't. Parallel to {@link SearchByTextRequest} — same dispatch model. */
export interface TextRecord {
	readonly id: string;
	readonly text: string;
	readonly payload?: Readonly<Record<string, unknown>>;
}

/** Fields shared by every search variant. */
export interface SearchOptions {
	/** Default 10, max 1000. */
	readonly topK?: number;
	/** Shallow-equal filter over payload keys. Nulls and missing keys
	 * don't match. Backends that support richer filter DSLs are
	 * free to extend this; the portable shape is shallow-equal. */
	readonly filter?: Readonly<Record<string, unknown>>;
	/** Include the full embedding vector in each hit. Default false. */
	readonly includeEmbeddings?: boolean;
}

/** A vector ANN search. Always supported. */
export interface SearchRequest extends SearchOptions {
	readonly vector: readonly number[];
}

/** A text search driven by the backend's own server-side embedding —
 * e.g. Astra `$vectorize`. Only implemented by drivers whose
 * underlying collections have a server-side embedding service wired
 * up; the route layer catches {@link NotSupportedError} and falls
 * back to client-side embedding + a vector search. */
export interface SearchByTextRequest extends SearchOptions {
	readonly text: string;
}

/** A hybrid (vector + lexical) search. Requires both a vector AND the
 * originating text — the lexical lane needs the raw query string the
 * vector was derived from. Only implemented by drivers whose stores
 * retain some lexical signal (Astra `$hybrid`, mock with stored
 * text). The route layer catches {@link NotSupportedError} and
 * surfaces it as a 501 to the caller. */
export interface SearchHybridRequest extends SearchOptions {
	readonly vector: readonly number[];
	readonly text: string;
	/** Weight of the lexical score relative to the vector score when
	 * combining, in `[0, 1]`. Default `0.5` — equal weight. Drivers
	 * are free to interpret this as a hint rather than a guarantee. */
	readonly lexicalWeight?: number;
}

/** Input to driver-side reranking — the text of the original query
 * and the hits to be reordered. The driver returns a new ordering
 * (usually a prefix) of the same hits. Optional — drivers without a
 * reranker throw {@link NotSupportedError}. */
export interface RerankInput {
	readonly text: string;
	readonly hits: readonly SearchHit[];
}

/** A single result from a search. */
export interface SearchHit {
	readonly id: string;
	/** Similarity score per the descriptor's `vectorSimilarity` metric.
	 * Higher is better for cosine/dot; for euclidean the convention is
	 * score = 1 / (1 + distance) so higher still means closer. */
	readonly score: number;
	readonly payload?: Readonly<Record<string, unknown>>;
	readonly vector?: readonly number[];
}

/** The contract every backend implements. */
export interface VectorStoreDriver {
	createCollection(ctx: VectorStoreDriverContext): Promise<void>;
	dropCollection(ctx: VectorStoreDriverContext): Promise<void>;

	upsert(
		ctx: VectorStoreDriverContext,
		records: readonly VectorRecord[],
	): Promise<{ upserted: number }>;

	deleteRecord(
		ctx: VectorStoreDriverContext,
		id: string,
	): Promise<{ deleted: boolean }>;

	search(
		ctx: VectorStoreDriverContext,
		req: SearchRequest,
	): Promise<readonly SearchHit[]>;

	/**
	 * Server-side-embedded text search. Optional — drivers without a
	 * server-side embedding path (today: everyone; tomorrow: Astra
	 * once vectorize is wired through createCollection / upsert)
	 * should either omit this method or throw {@link NotSupportedError}.
	 * The route layer uses the throw to decide whether to fall back
	 * to client-side embedding.
	 */
	searchByText?(
		ctx: VectorStoreDriverContext,
		req: SearchByTextRequest,
	): Promise<readonly SearchHit[]>;

	/**
	 * Server-side-embedded upsert. Receives `{id, text, payload?}`
	 * records and forwards them via the backend's own embedding service
	 * (Astra `$vectorize`). Optional — omit or throw
	 * {@link NotSupportedError} on drivers/collections that can't do
	 * server-side embedding; the route layer will then embed
	 * client-side via the descriptor's `embedding` config and fall
	 * back to a plain {@link upsert}.
	 */
	upsertByText?(
		ctx: VectorStoreDriverContext,
		records: readonly TextRecord[],
	): Promise<{ upserted: number }>;

	/**
	 * Hybrid (vector + lexical) search. Optional — drivers without a
	 * lexical index throw {@link NotSupportedError} and the route layer
	 * surfaces that as a 501 to the caller. Called only when the
	 * request sets `hybrid: true` or the descriptor has
	 * `lexical.enabled: true`.
	 */
	searchHybrid?(
		ctx: VectorStoreDriverContext,
		req: SearchHybridRequest,
	): Promise<readonly SearchHit[]>;

	/**
	 * Driver-side reranker — takes the hits from a vector or hybrid
	 * pass and reorders them using a second, higher-quality signal
	 * (cross-encoder, Astra reranking service, etc.). Optional —
	 * drivers without a reranker throw {@link NotSupportedError}.
	 * Invoked only when the request sets `rerank: true` or the
	 * descriptor has `reranking.enabled: true`.
	 */
	rerank?(
		ctx: VectorStoreDriverContext,
		input: RerankInput,
	): Promise<readonly SearchHit[]>;

	/**
	 * Discover collections that already exist in the backing data plane
	 * for this workspace but aren't yet wrapped in a workbench
	 * descriptor — e.g. tables created by `astra-db-ts` directly, by an
	 * older workbench install that was wiped, or by hand. Optional —
	 * drivers without a notion of "external collections" (the mock,
	 * for instance) should omit this method or return an empty list.
	 *
	 * The route layer pairs this with the descriptor table to build the
	 * "adoptable" list (anything here that doesn't already have a
	 * descriptor row), then offers the user a one-click adopt that
	 * stamps a descriptor pointing at the existing collection without
	 * re-provisioning it.
	 */
	listAdoptable?(
		workspace: WorkspaceRecord,
	): Promise<readonly AdoptableCollection[]>;

	/**
	 * Plain (non-similarity-ordered) list of records matching a
	 * payload filter, capped at `limit`. Optional — the route layer
	 * uses this to drive the document-chunks view, which wants
	 * "every chunk under documentUid X" without the rank/similarity
	 * shape of `search`. Drivers that can implement it cheaply (a
	 * direct `find()` against the underlying collection on Astra,
	 * an in-memory filter on mock) should; otherwise omit and the
	 * route returns 501.
	 */
	listRecords?(
		ctx: VectorStoreDriverContext,
		req: ListRecordsRequest,
	): Promise<readonly StoredRecord[]>;

	/**
	 * Bulk delete by payload filter. Used by the cascade-delete path
	 * on `DELETE .../documents/{d}` so removing a document also wipes
	 * its chunks from the bound collection — otherwise chunks would
	 * orphan and still surface via catalog-scoped search. Drivers
	 * that can't do this in one call (or don't support it) should
	 * omit; the route layer falls back to `listRecords` +
	 * `deleteRecord` per row.
	 */
	deleteRecords?(
		ctx: VectorStoreDriverContext,
		filter: Readonly<Record<string, unknown>>,
	): Promise<{ deleted: number }>;
}

export interface ListRecordsRequest {
	/** Payload filter, shallow-equal. Identical semantics to
	 * `SearchRequest.filter` — keys not in the doc are ignored. */
	readonly filter: Readonly<Record<string, unknown>>;
	/** Hard cap on returned rows. Defaults to 1000 at the route. */
	readonly limit?: number;
}

export interface StoredRecord {
	readonly id: string;
	readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Metadata extracted from an existing data-plane collection, sufficient
 * to populate a workbench descriptor on adoption. Vectorless
 * collections are filtered out by the driver — they're not useful to
 * the workbench's vector-store surface.
 */
export interface AdoptableCollection {
	/** Backend-native collection name. Doubles as the workbench
	 * descriptor name on adoption (the existing
	 * `collectionName(descriptor)` mapping returns descriptor.name when
	 * it satisfies the [A-Za-z][A-Za-z0-9_]{0,47} constraint Astra
	 * already enforced on the source side). */
	readonly name: string;
	readonly vectorDimension: number;
	readonly vectorSimilarity: "cosine" | "dot" | "euclidean";
	/** Server-side embedding service (`$vectorize`) attached to the
	 * collection, when one is configured — `null` for collections that
	 * expect client-side embedding. */
	readonly embedding: {
		readonly provider: string;
		readonly model: string;
	} | null;
	readonly lexicalEnabled: boolean;
	readonly rerankEnabled: boolean;
	readonly rerankProvider: string | null;
	readonly rerankModel: string | null;
}

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

/** Driver received a call for a workspace kind it doesn't handle. */
export class DriverUnavailableError extends Error {
	constructor(
		public readonly workspaceKind: string,
		message?: string,
	) {
		super(
			message ??
				`no vector-store driver registered for workspace kind '${workspaceKind}'`,
		);
		this.name = "DriverUnavailableError";
	}
}

/** Workspace is missing required connection config (endpoint / token / keyspace). */
export class WorkspaceMisconfiguredError extends Error {
	constructor(
		public readonly workspaceUid: string,
		public readonly missing: string,
	) {
		super(
			`workspace '${workspaceUid}' is missing '${missing}' — required by its driver`,
		);
		this.name = "WorkspaceMisconfiguredError";
	}
}

/** Underlying collection isn't reachable or doesn't exist. */
export class CollectionUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CollectionUnavailableError";
	}
}

/** Supplied vector's length doesn't match the descriptor's configured dimension. */
export class DimensionMismatchError extends Error {
	constructor(
		public readonly expected: number,
		public readonly got: number,
	) {
		super(`expected vector dimension ${expected}, got ${got}`);
		this.name = "DimensionMismatchError";
	}
}

/** Raised by a driver when an optional capability isn't available on
 * the underlying collection — e.g. text search on a collection that
 * wasn't created with a server-side embedding service. */
export class NotSupportedError extends Error {
	constructor(
		public readonly capability: string,
		reason?: string,
	) {
		super(
			reason ??
				`capability '${capability}' is not available on this collection`,
		);
		this.name = "NotSupportedError";
	}
}
