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
	NotSupportedError,
	type SearchByTextRequest,
	type SearchHit,
	type SearchRequest,
	type VectorRecord,
	type VectorStoreDriver,
	type VectorStoreDriverContext,
	WorkspaceMisconfiguredError,
} from "../vector-store.js";
import {
	isVectorizeNotConfigured,
	resolveVectorizeService,
	type VectorizeService,
} from "./vectorize.js";

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

/** Translate an Astra doc `{ _id, $vector, $similarity, ...payload }`
 *  into a `SearchHit`. Reused by both `search` and `searchByText`. */
function toHit(
	doc: Record<string, unknown>,
	includeEmbeddings?: boolean,
): SearchHit {
	const { _id, $vector, $similarity, ...payload } = doc as {
		_id: string;
		$vector?: number[];
		$similarity?: number;
		[k: string]: unknown;
	};
	return {
		id: _id,
		score: typeof $similarity === "number" ? $similarity : 0,
		payload: Object.keys(payload).length > 0 ? payload : undefined,
		vector: includeEmbeddings ? $vector : undefined,
	};
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
export interface AstraCreateCollectionOptions {
	vector: {
		dimension: number;
		metric: "cosine" | "dot_product" | "euclidean";
		service?: VectorizeService;
	};
}

export interface AstraCollectionHandleOptions {
	/** Per-request API key for the upstream embedding provider. Used by
	 *  $vectorize — Astra forwards this as an `x-embedding-api-key`
	 *  header instead of dipping into its own KMS. */
	embeddingApiKey?: string;
}

export interface AstraDbLike {
	createCollection(
		name: string,
		opts: AstraCreateCollectionOptions,
	): Promise<unknown>;
	dropCollection(name: string): Promise<unknown>;
	collection(
		name: string,
		opts?: AstraCollectionHandleOptions,
	): AstraCollectionLike;
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
	private readonly embeddingKeys = new Map<string, string>();

	constructor(opts: AstraVectorStoreDriverOptions) {
		this.secrets = opts.secrets;
		this.dbFactory = opts.dbFactory ?? defaultDbFactory;
	}

	async createCollection(ctx: VectorStoreDriverContext): Promise<void> {
		const db = await this.getDb(ctx.workspace);
		const service = resolveVectorizeService(ctx.descriptor.embedding);
		await db.createCollection(collectionName(ctx.descriptor), {
			vector: {
				dimension: ctx.descriptor.vectorDimension,
				metric: mapMetric(ctx.descriptor.vectorSimilarity),
				...(service ? { service } : {}),
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
		return docs.map((doc) => toHit(doc, req.includeEmbeddings));
	}

	/**
	 * Server-side embedding via Astra's `$vectorize` sort. Requires the
	 * collection to have been created with a `service` block — if the
	 * descriptor's embedding isn't a provider we opt into, or Astra
	 * reports the collection doesn't have vectorize wired up, throw
	 * {@link NotSupportedError} so the route layer falls back to
	 * client-side embedding.
	 */
	async searchByText(
		ctx: VectorStoreDriverContext,
		req: SearchByTextRequest,
	): Promise<readonly SearchHit[]> {
		const service = resolveVectorizeService(ctx.descriptor.embedding);
		if (!service) {
			throw new NotSupportedError(
				"searchByText",
				`embedding.provider '${ctx.descriptor.embedding.provider}' is not wired into Astra vectorize — falling back to client-side embedding`,
			);
		}
		const embeddingApiKey = await this.resolveEmbeddingKey(ctx);
		const topK = Math.max(1, Math.min(req.topK ?? 10, 1000));
		const db = await this.getDb(ctx.workspace);
		const coll = db.collection(collectionName(ctx.descriptor), {
			embeddingApiKey,
		});
		try {
			const cursor = coll.find(req.filter ?? {}, {
				sort: { $vectorize: req.text },
				limit: topK,
				includeSimilarity: true,
			});
			const docs = await cursor.toArray();
			return docs.map((doc) => toHit(doc, req.includeEmbeddings));
		} catch (err) {
			// Some tenants have collections created without the service
			// block (pre-vectorize, or by a different tool). Translate
			// the Astra "vectorize not configured" family of errors so
			// the route layer falls back to client-side embedding on
			// those collections automatically.
			if (isVectorizeNotConfigured(err)) {
				throw new NotSupportedError(
					"searchByText",
					"collection does not have an Astra vectorize service configured",
				);
			}
			throw err;
		}
	}

	/**
	 * Resolve the embedding-provider API key for a descriptor. Used by
	 * the vectorize path to attach an `x-embedding-api-key` header on
	 * each collection call. Returns `undefined` when no secret is set
	 * — in that case Astra has to fall back on its own KMS lookup
	 * (configured out-of-band), or the call will 401.
	 *
	 * Cached per descriptor UID so a burst of queries only pays the
	 * secret-resolver cost once. Workspace-level secrets rotate by
	 * runtime restart, same as the DB-connection cache.
	 */
	private async resolveEmbeddingKey(
		ctx: VectorStoreDriverContext,
	): Promise<string | undefined> {
		const ref = ctx.descriptor.embedding.secretRef;
		if (!ref) return undefined;
		const cached = this.embeddingKeys.get(ctx.descriptor.uid);
		if (cached) return cached;
		try {
			const key = await this.secrets.resolve(ref);
			this.embeddingKeys.set(ctx.descriptor.uid, key);
			return key;
		} catch (err) {
			throw new CollectionUnavailableError(
				`failed to resolve embedding.secretRef for vector store '${ctx.descriptor.uid}': ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
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
