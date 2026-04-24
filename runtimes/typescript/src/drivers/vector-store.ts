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
