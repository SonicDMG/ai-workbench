/**
 * Astra Data API {@link VectorStoreDriver} for workspaces with
 * `kind: "astra"`.
 *
 * Uses Data API **Collections** (not Tables — control-plane metadata
 * uses Tables; the vector data plane uses Collections, which have
 * first-class vector-search support).
 *
 * Connection management:
 *   - One {@link DataAPIClient} per workspace, cached lazily in
 *     {@link AstraVectorStoreDriver.clients}.
 *   - Token resolved through the injected {@link SecretResolver} the
 *     first time we touch a workspace.
 *   - Cache is in-process and not invalidated on workspace mutations —
 *     operators rotating credentials should restart the runtime for
 *     now. Phase 2 will add a smarter cache tied to workspace
 *     `updatedAt`.
 */

import { DataAPIClient, type Db } from "@datastax/astra-db-ts";
import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../control-plane/types.js";
import type { SecretResolver } from "../../secrets/provider.js";
import {
	CollectionUnavailableError,
	DimensionMismatchError,
	type SearchHit,
	type SearchRequest,
	type VectorRecord,
	type VectorStoreDriver,
	type VectorStoreDriverContext,
	WorkspaceMisconfiguredError,
} from "../vector-store.js";

/** Our similarity enum → the enum astra-db-ts's CollectionVectorOptions uses. */
function mapMetric(
	m: VectorStoreRecord["vectorSimilarity"],
): "cosine" | "dot_product" | "euclidean" {
	switch (m) {
		case "cosine":
			return "cosine";
		case "dot":
			return "dot_product";
		case "euclidean":
			return "euclidean";
	}
}

function collectionName(descriptor: VectorStoreRecord): string {
	// Astra collection names are [a-zA-Z][a-zA-Z0-9_]* up to 48 chars.
	// Descriptor.name is human-authored; fall back to the uid (stripped
	// of hyphens) to guarantee a valid identifier.
	const candidate = descriptor.name;
	if (/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(candidate)) return candidate;
	return `vs_${descriptor.uid.replace(/-/g, "").slice(0, 40)}`;
}

/**
 * Structural interface for the subset of `Db` we actually use. Lets
 * tests inject a fake without depending on astra-db-ts's type
 * parameters.
 */
export interface AstraDbLike {
	createCollection(
		name: string,
		opts: {
			vector: {
				dimension: number;
				metric: "cosine" | "dot_product" | "euclidean";
			};
		},
	): Promise<unknown>;
	dropCollection(name: string): Promise<unknown>;
	collection(name: string): AstraCollectionLike;
}

export interface AstraCollectionLike {
	insertOne(doc: Record<string, unknown>): Promise<unknown>;
	insertMany(docs: readonly Record<string, unknown>[]): Promise<unknown>;
	deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
	find(
		filter: Record<string, unknown>,
		opts?: {
			sort?: Record<string, unknown>;
			limit?: number;
			includeSimilarity?: boolean;
			projection?: Record<string, unknown>;
		},
	): { toArray(): Promise<Array<Record<string, unknown>>> };
}

/**
 * Called with already-resolved connection params. `endpoint` and
 * `token` are the post-{@link SecretResolver} values; the factory
 * just builds a `Db` handle. Tests override to inject a fake `Db`.
 */
export type DbFactory = (
	workspace: WorkspaceRecord,
	endpoint: string,
	token: string,
) => AstraDbLike;

export interface AstraVectorStoreDriverOptions {
	readonly secrets: SecretResolver;
	/** Override to swap in a fake DB for tests. Defaults to using
	 * `@datastax/astra-db-ts`'s real `DataAPIClient`. */
	readonly dbFactory?: DbFactory;
}

const defaultDbFactory: DbFactory = (workspace, endpoint, token) => {
	const client = new DataAPIClient(token);
	const keyspace = workspace.keyspace ?? undefined;
	return client.db(
		endpoint,
		keyspace ? { keyspace } : {},
	) as unknown as AstraDbLike;
};

export class AstraVectorStoreDriver implements VectorStoreDriver {
	private readonly secrets: SecretResolver;
	private readonly dbFactory: DbFactory;
	private readonly dbs = new Map<string, AstraDbLike>();

	constructor(opts: AstraVectorStoreDriverOptions) {
		this.secrets = opts.secrets;
		this.dbFactory = opts.dbFactory ?? defaultDbFactory;
	}

	async createCollection(ctx: VectorStoreDriverContext): Promise<void> {
		const db = await this.getDb(ctx.workspace);
		await db.createCollection(collectionName(ctx.descriptor), {
			vector: {
				dimension: ctx.descriptor.vectorDimension,
				metric: mapMetric(ctx.descriptor.vectorSimilarity),
			},
		});
	}

	async dropCollection(ctx: VectorStoreDriverContext): Promise<void> {
		const db = await this.getDb(ctx.workspace);
		await db.dropCollection(collectionName(ctx.descriptor));
	}

	async upsert(
		ctx: VectorStoreDriverContext,
		records: readonly VectorRecord[],
	): Promise<{ upserted: number }> {
		const expectedDim = ctx.descriptor.vectorDimension;
		for (const r of records) {
			if (r.vector.length !== expectedDim) {
				throw new DimensionMismatchError(expectedDim, r.vector.length);
			}
		}
		if (records.length === 0) return { upserted: 0 };
		const coll = (await this.getDb(ctx.workspace)).collection(
			collectionName(ctx.descriptor),
		);
		const docs = records.map((r) => ({
			_id: r.id,
			$vector: [...r.vector],
			...(r.payload ?? {}),
		}));
		await coll.insertMany(docs);
		return { upserted: records.length };
	}

	async deleteRecord(
		ctx: VectorStoreDriverContext,
		id: string,
	): Promise<{ deleted: boolean }> {
		const coll = (await this.getDb(ctx.workspace)).collection(
			collectionName(ctx.descriptor),
		);
		const res = await coll.deleteOne({ _id: id });
		return { deleted: res.deletedCount > 0 };
	}

	async search(
		ctx: VectorStoreDriverContext,
		req: SearchRequest,
	): Promise<readonly SearchHit[]> {
		const expectedDim = ctx.descriptor.vectorDimension;
		if (req.vector.length !== expectedDim) {
			throw new DimensionMismatchError(expectedDim, req.vector.length);
		}
		const topK = Math.max(1, Math.min(req.topK ?? 10, 1000));
		const coll = (await this.getDb(ctx.workspace)).collection(
			collectionName(ctx.descriptor),
		);
		const cursor = coll.find(req.filter ?? {}, {
			sort: { $vector: [...req.vector] },
			limit: topK,
			includeSimilarity: true,
		});
		const docs = await cursor.toArray();
		return docs.map((doc) => {
			const { _id, $vector, $similarity, ...payload } = doc as {
				_id: string;
				$vector?: number[];
				$similarity?: number;
				[k: string]: unknown;
			};
			const hit: SearchHit = {
				id: _id,
				score: typeof $similarity === "number" ? $similarity : 0,
				payload: Object.keys(payload).length > 0 ? payload : undefined,
				vector: req.includeEmbeddings ? $vector : undefined,
			};
			return hit;
		});
	}

	private async getDb(workspace: WorkspaceRecord): Promise<AstraDbLike> {
		const cached = this.dbs.get(workspace.uid);
		if (cached) return cached;

		if (!workspace.endpoint) {
			throw new WorkspaceMisconfiguredError(workspace.uid, "endpoint");
		}
		const tokenRef = workspace.credentialsRef.token;
		if (!tokenRef) {
			throw new WorkspaceMisconfiguredError(
				workspace.uid,
				"credentialsRef.token",
			);
		}

		let endpoint: string;
		try {
			endpoint = await this.resolveMaybeRef(workspace.endpoint);
		} catch (err) {
			throw new CollectionUnavailableError(
				`failed to resolve Astra endpoint for workspace '${workspace.uid}': ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}

		let token: string;
		try {
			token = await this.secrets.resolve(tokenRef);
		} catch (err) {
			throw new CollectionUnavailableError(
				`failed to resolve Astra token for workspace '${workspace.uid}': ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}

		const db = this.dbFactory(workspace, endpoint, token);
		this.dbs.set(workspace.uid, db);
		return db;
	}

	/**
	 * Treat a value as a {@link SecretRef} if its `<prefix>` portion
	 * matches a registered provider (`env`, `file`, …); otherwise
	 * return it as-is (literal URL).
	 */
	private async resolveMaybeRef(value: string): Promise<string> {
		const colon = value.indexOf(":");
		if (colon > 0) {
			const prefix = value.slice(0, colon).toLowerCase();
			if (this.secrets.has(prefix)) return this.secrets.resolve(value);
		}
		return value;
	}
}

/** Exposed so tests can assert on the connection-cache shape. */
export const _AstraDbTypeGuard: Db | undefined = undefined;
