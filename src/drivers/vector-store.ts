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

/** A search request against a vector store. */
export interface SearchRequest {
	readonly vector: readonly number[];
	/** Default 10, max 1000. */
	readonly topK?: number;
	/** Shallow-equal filter over payload keys. Nulls and missing keys
	 * don't match. Backends that support richer filter DSLs are
	 * free to extend this; the portable shape is shallow-equal. */
	readonly filter?: Readonly<Record<string, unknown>>;
	/** Include the full embedding vector in each hit. Default false. */
	readonly includeEmbeddings?: boolean;
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
