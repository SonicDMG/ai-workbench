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
	AstraCollectionLike,
	AstraDbLike,
} from "../../src/drivers/astra/store.js";

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
				if (sortVec && includeSim) {
					const v = doc.$vector as number[] | undefined;
					withSim.$similarity = v ? cosine(v, sortVec) : 0;
				}
				return withSim;
			});
		if (sortVec) {
			arr.sort((a, b) => {
				const sa = cosine((a.$vector as number[]) ?? [], sortVec);
				const sb = cosine((b.$vector as number[]) ?? [], sortVec);
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
}

export class FakeDb implements AstraDbLike {
	private collections = new Map<string, FakeCollection>();

	async createCollection(
		name: string,
		_opts: {
			vector: {
				dimension: number;
				metric: "cosine" | "dot_product" | "euclidean";
			};
		},
	): Promise<unknown> {
		if (!this.collections.has(name))
			this.collections.set(name, new FakeCollection());
		return { name };
	}

	async dropCollection(name: string): Promise<unknown> {
		this.collections.delete(name);
		return { name };
	}

	collection(name: string): AstraCollectionLike {
		const c = this.collections.get(name);
		if (!c) {
			// Lazy-create to mimic astra-db-ts's `.collection()` handle which
			// doesn't verify existence until the first operation. Keeps the
			// contract suite focused on driver behavior, not mock plumbing.
			const nc = new FakeCollection();
			this.collections.set(name, nc);
			return nc;
		}
		return c;
	}
}
