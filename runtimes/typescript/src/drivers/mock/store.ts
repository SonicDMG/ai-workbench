/**
 * In-memory {@link VectorStoreDriver} for workspaces with
 * `kind: "mock"`.
 *
 * Holds state in per-(workspace, descriptor) maps. Not durable —
 * state is lost on process exit. Intended for CI, tests, and demos
 * where no external vector database is available.
 *
 * Similarity math matches what the {@link VectorStoreRecord.vectorSimilarity}
 * field declares:
 *   - `cosine`     — normalized dot product
 *   - `dot`        — plain dot product
 *   - `euclidean`  — `1 / (1 + distance)` so "bigger is closer"
 *     (matches the convention on the {@link SearchHit.score} field)
 */

import {
	CollectionUnavailableError,
	DimensionMismatchError,
	NotSupportedError,
	type RerankInput,
	type SearchByTextRequest,
	type SearchHit,
	type SearchHybridRequest,
	type SearchRequest,
	type TextRecord,
	type VectorRecord,
	type VectorStoreDriver,
	type VectorStoreDriverContext,
} from "../vector-store.js";

type Key = `${string}:${string}`;

function keyOf(ctx: VectorStoreDriverContext): Key {
	return `${ctx.workspace.uid}:${ctx.descriptor.uid}`;
}

function dot(a: readonly number[], b: readonly number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
	return sum;
}

function norm(a: readonly number[]): number {
	return Math.sqrt(dot(a, a));
}

function cosine(a: readonly number[], b: readonly number[]): number {
	const na = norm(a);
	const nb = norm(b);
	if (na === 0 || nb === 0) return 0;
	return dot(a, b) / (na * nb);
}

function euclidean(a: readonly number[], b: readonly number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		sum += d * d;
	}
	return 1 / (1 + Math.sqrt(sum));
}

function score(
	metric: "cosine" | "dot" | "euclidean",
	a: readonly number[],
	b: readonly number[],
): number {
	switch (metric) {
		case "cosine":
			return cosine(a, b);
		case "dot":
			return dot(a, b);
		case "euclidean":
			return euclidean(a, b);
	}
}

/**
 * Deterministic FNV-1a-seeded pseudo-embedding. Same text → same
 * vector; repeatable across test runs. Unit-norm so cosine works.
 */
export function mockEmbed(text: string, dimension: number): number[] {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	const out = new Array<number>(dimension);
	let sq = 0;
	for (let i = 0; i < dimension; i++) {
		// xorshift seeded with the FNV hash
		h ^= h << 13;
		h ^= h >>> 17;
		h ^= h << 5;
		const v = (h & 0xffff) / 0x10000 - 0.5;
		out[i] = v;
		sq += v * v;
	}
	const norm = Math.sqrt(sq) || 1;
	for (let i = 0; i < dimension; i++) out[i] = (out[i] as number) / norm;
	return out;
}

function matchesFilter(
	payload: Readonly<Record<string, unknown>> | undefined,
	filter: Readonly<Record<string, unknown>> | undefined,
): boolean {
	if (!filter) return true;
	if (!payload) return Object.keys(filter).length === 0;
	return Object.entries(filter).every(([k, v]) => payload[k] === v);
}

export class MockVectorStoreDriver implements VectorStoreDriver {
	/** Outer key = workspace.uid + descriptor.uid; inner map = recordId → record. */
	private readonly stores = new Map<Key, Map<string, VectorRecord>>();
	/** Parallel text store populated by {@link upsertByText}. Keyed
	 * the same way as {@link stores}, then by recordId. Used by
	 * {@link searchHybrid} and {@link rerank} to compute lexical
	 * scores. Records upserted via plain {@link upsert} (vectors only)
	 * do not appear here and score 0 on lexical. */
	private readonly texts = new Map<Key, Map<string, string>>();

	async createCollection(ctx: VectorStoreDriverContext): Promise<void> {
		// Idempotent: if it already exists, leave it alone.
		const k = keyOf(ctx);
		if (!this.stores.has(k)) this.stores.set(k, new Map());
		if (!this.texts.has(k)) this.texts.set(k, new Map());
	}

	async dropCollection(ctx: VectorStoreDriverContext): Promise<void> {
		const k = keyOf(ctx);
		this.stores.delete(k);
		this.texts.delete(k);
	}

	async upsert(
		ctx: VectorStoreDriverContext,
		records: readonly VectorRecord[],
	): Promise<{ upserted: number }> {
		const store = this.requireStore(ctx);
		const expectedDim = ctx.descriptor.vectorDimension;
		for (const r of records) {
			if (r.vector.length !== expectedDim) {
				throw new DimensionMismatchError(expectedDim, r.vector.length);
			}
			store.set(r.id, {
				id: r.id,
				vector: [...r.vector],
				payload: r.payload ? { ...r.payload } : undefined,
			});
		}
		return { upserted: records.length };
	}

	async deleteRecord(
		ctx: VectorStoreDriverContext,
		id: string,
	): Promise<{ deleted: boolean }> {
		const store = this.requireStore(ctx);
		const deleted = store.delete(id);
		this.texts.get(keyOf(ctx))?.delete(id);
		return { deleted };
	}

	async listRecords(
		ctx: VectorStoreDriverContext,
		req: import("../vector-store.js").ListRecordsRequest,
	): Promise<readonly import("../vector-store.js").StoredRecord[]> {
		const store = this.requireStore(ctx);
		const limit = Math.max(1, Math.min(req.limit ?? 1000, 1000));
		const out: import("../vector-store.js").StoredRecord[] = [];
		for (const rec of store.values()) {
			if (!matchesFilter(rec.payload, req.filter)) continue;
			out.push({ id: rec.id, payload: rec.payload ?? {} });
			if (out.length >= limit) break;
		}
		return out;
	}

	async deleteRecords(
		ctx: VectorStoreDriverContext,
		filter: Readonly<Record<string, unknown>>,
	): Promise<{ deleted: number }> {
		const store = this.requireStore(ctx);
		const texts = this.texts.get(keyOf(ctx));
		const ids: string[] = [];
		for (const rec of store.values()) {
			if (matchesFilter(rec.payload, filter)) ids.push(rec.id);
		}
		for (const id of ids) {
			store.delete(id);
			texts?.delete(id);
		}
		return { deleted: ids.length };
	}

	async search(
		ctx: VectorStoreDriverContext,
		req: SearchRequest,
	): Promise<readonly SearchHit[]> {
		const store = this.requireStore(ctx);
		const expectedDim = ctx.descriptor.vectorDimension;
		if (req.vector.length !== expectedDim) {
			throw new DimensionMismatchError(expectedDim, req.vector.length);
		}
		const topK = Math.max(1, Math.min(req.topK ?? 10, 1000));
		const metric = ctx.descriptor.vectorSimilarity;

		const hits: SearchHit[] = [];
		for (const rec of store.values()) {
			if (!matchesFilter(rec.payload, req.filter)) continue;
			hits.push({
				id: rec.id,
				score: score(metric, req.vector, rec.vector),
				payload: rec.payload,
				vector: req.includeEmbeddings ? [...rec.vector] : undefined,
			});
		}
		hits.sort((a, b) => b.score - a.score);
		return hits.slice(0, topK);
	}

	/**
	 * Deterministic pseudo-embedding of a text string.
	 *
	 * Used only by `searchByText` in the mock driver so tests can
	 * exercise the route's driver-first dispatch branch without
	 * pulling in the Vercel SDK. The same hash is applied at upsert
	 * time if the caller uses `payload.$mockText`, so queries find
	 * the documents they "embedded" with the same seed.
	 */
	/**
	 * Server-side-embedded upsert. Mirrors searchByText: only fires
	 * when `descriptor.embedding.provider === "mock"` (the opt-in flag
	 * for mock vectorize). Calls mockEmbed per record, then routes
	 * through regular upsert.
	 */
	async upsertByText(
		ctx: VectorStoreDriverContext,
		records: readonly TextRecord[],
	): Promise<{ upserted: number }> {
		if (ctx.descriptor.embedding.provider !== "mock") {
			throw new NotSupportedError(
				"upsertByText",
				"mock driver only supports text upsert when descriptor.embedding.provider == 'mock'",
			);
		}
		const expanded: VectorRecord[] = records.map((r) => ({
			id: r.id,
			vector: mockEmbed(r.text, ctx.descriptor.vectorDimension),
			payload: r.payload,
		}));
		const result = await this.upsert(ctx, expanded);
		// Retain the raw text so searchHybrid / rerank have a lexical
		// signal to work with. Keyed per collection.
		const textsForStore = this.texts.get(keyOf(ctx)) ?? new Map();
		for (const r of records) textsForStore.set(r.id, r.text);
		this.texts.set(keyOf(ctx), textsForStore);
		return result;
	}

	async searchHybrid(
		ctx: VectorStoreDriverContext,
		req: SearchHybridRequest,
	): Promise<readonly SearchHit[]> {
		// Same gate as searchByText — hybrid only makes sense when the
		// descriptor opted into mock's text lane.
		if (ctx.descriptor.embedding.provider !== "mock") {
			throw new NotSupportedError(
				"searchHybrid",
				"mock driver only supports hybrid search when descriptor.embedding.provider == 'mock'",
			);
		}
		const vectorHits = await this.search(ctx, {
			vector: req.vector,
			topK: 1000, // widen the pool; we cut down after combining
			filter: req.filter,
			includeEmbeddings: req.includeEmbeddings,
		});
		const texts = this.texts.get(keyOf(ctx));
		const lexicalWeight = clamp01(req.lexicalWeight ?? 0.5);
		const topK = Math.max(1, Math.min(req.topK ?? 10, 1000));

		// Compute lexical score per hit, then min-max normalize vector
		// + lexical into [0, 1] so the weighted sum is meaningful.
		const queryTokens = tokenize(req.text);
		const lexical = vectorHits.map((h) =>
			lexicalScore(queryTokens, texts?.get(h.id) ?? ""),
		);
		const vectorRaw = vectorHits.map((h) => h.score);
		const vectorNorm = minMaxNormalize(vectorRaw);
		const lexicalNorm = minMaxNormalize(lexical);

		const combined = vectorHits.map((h, i) => ({
			...h,
			score:
				(1 - lexicalWeight) * (vectorNorm[i] ?? 0) +
				lexicalWeight * (lexicalNorm[i] ?? 0),
		}));
		combined.sort((a, b) => b.score - a.score);
		return combined.slice(0, topK);
	}

	async rerank(
		ctx: VectorStoreDriverContext,
		input: RerankInput,
	): Promise<readonly SearchHit[]> {
		if (ctx.descriptor.embedding.provider !== "mock") {
			throw new NotSupportedError(
				"rerank",
				"mock driver only supports rerank when descriptor.embedding.provider == 'mock'",
			);
		}
		const texts = this.texts.get(keyOf(ctx));
		const queryTokens = tokenize(input.text);
		const scored = input.hits.map((h) => ({
			...h,
			score: lexicalScore(queryTokens, texts?.get(h.id) ?? ""),
		}));
		scored.sort((a, b) => b.score - a.score);
		return scored;
	}

	async searchByText(
		ctx: VectorStoreDriverContext,
		req: SearchByTextRequest,
	): Promise<readonly SearchHit[]> {
		// Refuse unless the descriptor opted into mock server-side
		// embedding via `embedding.provider == "mock"`. Matches the
		// real-driver contract: text search only works when the
		// underlying collection was set up for it.
		if (ctx.descriptor.embedding.provider !== "mock") {
			throw new NotSupportedError(
				"searchByText",
				"mock driver only supports text search when descriptor.embedding.provider == 'mock'",
			);
		}
		const vector = mockEmbed(req.text, ctx.descriptor.vectorDimension);
		return this.search(ctx, {
			vector,
			topK: req.topK,
			filter: req.filter,
			includeEmbeddings: req.includeEmbeddings,
		});
	}

	private requireStore(
		ctx: VectorStoreDriverContext,
	): Map<string, VectorRecord> {
		const store = this.stores.get(keyOf(ctx));
		if (!store) {
			throw new CollectionUnavailableError(
				`collection for vector store '${ctx.descriptor.uid}' in workspace '${ctx.workspace.uid}' not provisioned`,
			);
		}
		return store;
	}
}

/** Cheap lowercase tokenizer — good enough for the mock driver's
 * lexical signal. Not Unicode-aware; operators with international
 * content should point `lexical.analyzer` at a real implementation
 * once the astra lexical lane lands. */
function tokenize(text: string): readonly string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/u)
		.filter((t) => t.length > 0);
}

/** Lexical score = (matching tokens) / (stored token count). Defined
 * per the mock's limited needs — NOT a faithful BM25. Empty stored
 * text scores 0. */
function lexicalScore(
	queryTokens: readonly string[],
	storedText: string,
): number {
	if (storedText.length === 0) return 0;
	const storedTokens = tokenize(storedText);
	if (storedTokens.length === 0) return 0;
	const querySet = new Set(queryTokens);
	let matches = 0;
	for (const t of storedTokens) if (querySet.has(t)) matches++;
	return matches / storedTokens.length;
}

/** Min-max normalize into `[0, 1]`. If all values are identical the
 * output is all zeros — avoids a divide-by-zero and preserves the
 * "no signal" interpretation. */
function minMaxNormalize(values: readonly number[]): readonly number[] {
	if (values.length === 0) return [];
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const v of values) {
		if (v < min) min = v;
		if (v > max) max = v;
	}
	const span = max - min;
	if (span === 0) return values.map(() => 0);
	return values.map((v) => (v - min) / span);
}

function clamp01(n: number): number {
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}
