/**
 * In-memory fake of the subset of `astra-db-ts`'s `Db` / `Collection`
 * surface that {@link AstraVectorStoreDriver} uses.
 *
 * Good enough to run the shared driver contract suite without a real
 * Astra endpoint. Faithfulness is intentional for the `$vector` sort
 * semantics (cosine similarity) so that contract assertions about
 * score ordering hold.
 *
 * A real-Astra integration test is gated on `ASTRA_DB_*` env vars
 * and runs in a separate CI job when creds are available.
 */

import type {
	AstraCollectionHandleOptions,
	AstraCollectionLike,
	AstraCreateCollectionOptions,
	AstraDbLike,
} from "../../src/drivers/astra/store.js";

/** Deterministic fake embedder used by the $vectorize code path in
 *  the fake DB. Same input → same output, so similarity ordering is
 *  reproducible in tests. */
function pseudoEmbed(text: string, dim: number): number[] {
	let h = 2166136261 >>> 0; // FNV-1a seed
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	const out = new Array<number>(dim);
	for (let i = 0; i < dim; i++) {
		h ^= h << 13;
		h ^= h >>> 17;
		h ^= h << 5;
		out[i] = ((h >>> 0) % 10000) / 10000 - 0.5;
	}
	return out;
}

/** Error the fake throws when a $vectorize call lands on a collection
 *  that wasn't created with a `service` block — matches the shape
 *  `isVectorizeNotConfigured()` looks for in the driver. */
export class FakeVectorizeNotConfiguredError extends Error {
	readonly errorCode = "COLLECTION_VECTORIZE_NOT_CONFIGURED";
	constructor(collection: string) {
		super(
			`Field $vectorize is not supported on this collection (${collection}): service not configured`,
		);
		this.name = "FakeVectorizeNotConfiguredError";
	}
}

function cosine(a: readonly number[], b: readonly number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += (a[i] ?? 0) * (b[i] ?? 0);
		na += (a[i] ?? 0) ** 2;
		nb += (b[i] ?? 0) ** 2;
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb);
	return denom === 0 ? 0 : dot / denom;
}

class FakeCollection implements AstraCollectionLike {
	readonly docs = new Map<string, Record<string, unknown>>();

	constructor(
		readonly name: string,
		readonly service: AstraCreateCollectionOptions["vector"]["service"] | null,
		readonly dimension: number,
		readonly handleOpts: AstraCollectionHandleOptions | undefined,
		readonly lexicalEnabled: boolean = false,
		readonly rerankEnabled: boolean = false,
	) {}

	async insertOne(doc: Record<string, unknown>): Promise<unknown> {
		const id = doc._id as string;
		this.docs.set(id, { ...doc });
		return { insertedId: id };
	}

	async insertMany(docs: readonly Record<string, unknown>[]): Promise<unknown> {
		for (const d of docs) await this.insertOne(d);
		return { insertedIds: docs.map((d) => d._id as string) };
	}

	async deleteOne(
		filter: Record<string, unknown>,
	): Promise<{ deletedCount: number }> {
		const id = filter._id as string | undefined;
		if (id === undefined) return { deletedCount: 0 };
		return { deletedCount: this.docs.delete(id) ? 1 : 0 };
	}

	find(
		filter: Record<string, unknown>,
		opts?: {
			sort?: Record<string, unknown>;
			limit?: number;
			includeSimilarity?: boolean;
			projection?: Record<string, unknown>;
		},
	) {
		const sortVec = (opts?.sort?.$vector as number[] | undefined) ?? null;
		const sortText = (opts?.sort?.$vectorize as string | undefined) ?? null;
		// $vectorize on a non-service collection: refuse the same way
		// the real Data API does so the driver's NotSupported-mapping
		// branch actually runs in tests.
		if (sortText !== null && !this.service) {
			return {
				async toArray(): Promise<Array<Record<string, unknown>>> {
					throw new FakeVectorizeNotConfiguredError(this.collName);
				},
				collName: this.name,
			};
		}
		const effectiveVec = sortVec
			? sortVec
			: sortText !== null
				? pseudoEmbed(sortText, this.dimension)
				: null;
		const limit = opts?.limit ?? 1000;
		const includeSim = opts?.includeSimilarity ?? false;
		const arr = Array.from(this.docs.values())
			.filter((doc) => {
				const { _id: _i, $vector: _v, ...payload } = doc;
				return Object.entries(filter).every(
					([k, v]) => (payload as Record<string, unknown>)[k] === v,
				);
			})
			.map((doc) => {
				const withSim: Record<string, unknown> = { ...doc };
				if (effectiveVec && includeSim) {
					const v = doc.$vector as number[] | undefined;
					withSim.$similarity = v ? cosine(v, effectiveVec) : 0;
				}
				return withSim;
			});
		if (effectiveVec) {
			arr.sort((a, b) => {
				const sa = cosine((a.$vector as number[]) ?? [], effectiveVec);
				const sb = cosine((b.$vector as number[]) ?? [], effectiveVec);
				return sb - sa;
			});
		}
		const sliced = arr.slice(0, limit);
		return {
			async toArray(): Promise<Array<Record<string, unknown>>> {
				return sliced;
			},
		};
	}

	findAndRerank(
		filter: Record<string, unknown>,
		opts?: {
			sort?: { $hybrid: string | Record<string, unknown> };
			limit?: number;
			hybridLimits?: number | Record<string, number>;
			rerankOn?: string;
			rerankQuery?: string;
			includeScores?: boolean;
		},
	): {
		toArray(): Promise<
			Array<{
				document: Record<string, unknown>;
				scores: Record<string, number>;
			}>
		>;
	} {
		if (!this.lexicalEnabled || !this.rerankEnabled) {
			// Match the shape the real Data API produces when the
			// collection wasn't created with hybrid wiring.
			const name = this.name;
			return {
				async toArray() {
					throw new FakeVectorizeNotConfiguredError(name);
				},
			};
		}

		const hybrid = opts?.sort?.$hybrid;
		const $lexical = (
			typeof hybrid === "object" && hybrid !== null
				? (hybrid as { $lexical?: string }).$lexical
				: typeof hybrid === "string"
					? hybrid
					: undefined
		) as string | undefined;
		const $vectorOpt =
			typeof hybrid === "object" && hybrid !== null
				? ((hybrid as { $vector?: number[] }).$vector ?? null)
				: null;
		const $vectorize =
			typeof hybrid === "object" && hybrid !== null
				? ((hybrid as { $vectorize?: string }).$vectorize ?? null)
				: null;
		const vector =
			$vectorOpt ??
			($vectorize ? pseudoEmbed($vectorize, this.dimension) : null);
		const limit = opts?.limit ?? 10;

		// For each doc: compute the two scores, combine with a simple
		// 50/50 rerank. Faithful enough for ordering assertions in
		// contract tests; real Astra's reranker is model-specific.
		const rows: Array<{
			document: Record<string, unknown>;
			scores: Record<string, number>;
		}> = [];
		for (const doc of this.docs.values()) {
			const { _id: _i, $vector: _v, ...payload } = doc;
			if (
				!Object.entries(filter).every(
					([k, v]) => (payload as Record<string, unknown>)[k] === v,
				)
			) {
				continue;
			}
			const vecScore = vector
				? cosine((doc.$vector as number[]) ?? [], vector)
				: 0;
			const lexScore =
				$lexical !== undefined ? fakeLexicalScore($lexical, doc) : 0;
			const rerankerScore = 0.5 * vecScore + 0.5 * lexScore;
			rows.push({
				document: { ...doc },
				scores: {
					$vector: vecScore,
					$lexical: lexScore,
					$reranker: rerankerScore,
				},
			});
		}
		rows.sort((a, b) => (b.scores.$reranker ?? 0) - (a.scores.$reranker ?? 0));
		const sliced = rows.slice(0, limit);
		return {
			async toArray() {
				return sliced;
			},
		};
	}
}

/** Token-overlap score over a stringified payload. Not faithful to
 * a real lexical index — just gives the contract tests something
 * deterministic to assert on. */
function fakeLexicalScore(query: string, doc: Record<string, unknown>): number {
	const haystack = JSON.stringify(doc).toLowerCase();
	const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
	if (tokens.length === 0) return 0;
	let matches = 0;
	for (const t of tokens) if (haystack.includes(t)) matches++;
	return matches / tokens.length;
}

export class FakeDb implements AstraDbLike {
	private collections = new Map<string, FakeCollection>();
	/** Capture every createCollection call so tests can assert on the
	 *  options the driver passed. Public for assertions. */
	readonly createCalls: Array<{
		name: string;
		opts: AstraCreateCollectionOptions;
	}> = [];
	/** Capture every collection(name, opts) handle the driver asked
	 *  for. Lets tests assert that embeddingApiKey is attached. */
	readonly handleCalls: Array<{
		name: string;
		opts: AstraCollectionHandleOptions | undefined;
	}> = [];

	async createCollection(
		name: string,
		opts: AstraCreateCollectionOptions,
	): Promise<unknown> {
		this.createCalls.push({ name, opts });
		if (!this.collections.has(name)) {
			this.collections.set(
				name,
				new FakeCollection(
					name,
					opts.vector.service ?? null,
					opts.vector.dimension,
					undefined,
					opts.lexical?.enabled === true,
					opts.rerank?.enabled === true,
				),
			);
		}
		return { name };
	}

	async dropCollection(name: string): Promise<unknown> {
		this.collections.delete(name);
		return { name };
	}

	collection(
		name: string,
		opts?: AstraCollectionHandleOptions,
	): AstraCollectionLike {
		this.handleCalls.push({ name, opts });
		const c = this.collections.get(name);
		if (!c) {
			// Lazy-create to mimic astra-db-ts's `.collection()` handle which
			// doesn't verify existence until the first operation. Keeps the
			// contract suite focused on driver behavior, not mock plumbing.
			// Without a previous createCollection call we don't know the
			// service config — assume none (matches a pre-existing
			// vectorize-less collection).
			const nc = new FakeCollection(name, null, 0, opts);
			this.collections.set(name, nc);
			return nc;
		}
		return c;
	}
}
