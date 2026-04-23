/**
 * In-memory fake of the {@link TablesBundle} shape, for exercising the
 * {@link AstraControlPlaneStore} without a real Astra endpoint.
 *
 * Implements only the subset of behavior our store depends on:
 *   - `insertOne` appends a row (no upsert semantics — we always check
 *     existence first in the real store, matching contract expectations).
 *   - `findOne` picks the first row whose fields exactly match the
 *     filter (supports equality-only filters, which is all we ever
 *     send).
 *   - `find` returns a cursor over all matching rows.
 *   - `updateOne` mutates the first matching row using `$set`.
 *   - `deleteOne` / `deleteMany` drop matching rows.
 *
 * Not a faithful Data API Tables implementation — good enough to let
 * every contract assertion pass. A real-Astra integration test will
 * live under a CI gate once creds are available.
 */

import type {
	SomeRow,
	TableFilter,
	TableUpdateFilter,
} from "@datastax/astra-db-ts";
import type {
	ApiKeyLookupRow,
	ApiKeyRow,
	CatalogRow,
	DocumentRow,
	VectorStoreRow,
	WorkspaceRow,
} from "../../src/astra-client/row-types.js";
import type {
	Cursor,
	TableLike,
	TablesBundle,
} from "../../src/astra-client/tables.js";

function matches<Row extends SomeRow>(
	row: Row,
	filter: TableFilter<Row>,
): boolean {
	const f = filter as Record<string, unknown>;
	return Object.entries(f).every(
		([k, v]) => (row as Record<string, unknown>)[k] === v,
	);
}

class FakeTable<Row extends SomeRow> implements TableLike<Row> {
	private rows: Row[] = [];

	async insertOne(row: Row): Promise<unknown> {
		this.rows.push({ ...row });
		return { insertedId: row };
	}

	async findOne(filter: TableFilter<Row>): Promise<Row | null> {
		const hit = this.rows.find((r) => matches(r, filter));
		return hit ? { ...hit } : null;
	}

	find(filter: TableFilter<Row>): Cursor<Row> {
		const snapshot = this.rows
			.filter((r) => matches(r, filter))
			.map((r) => ({
				...r,
			}));
		return {
			async toArray(): Promise<Row[]> {
				return snapshot;
			},
		};
	}

	async updateOne(
		filter: TableFilter<Row>,
		update: TableUpdateFilter<Row>,
	): Promise<void> {
		const idx = this.rows.findIndex((r) => matches(r, filter));
		if (idx < 0) return;
		const set = (update as { $set?: Record<string, unknown> }).$set ?? {};
		const existing = this.rows[idx] as Row;
		this.rows[idx] = { ...existing, ...set } as Row;
	}

	async deleteOne(filter: TableFilter<Row>): Promise<void> {
		const idx = this.rows.findIndex((r) => matches(r, filter));
		if (idx >= 0) this.rows.splice(idx, 1);
	}

	async deleteMany(filter: TableFilter<Row>): Promise<void> {
		this.rows = this.rows.filter((r) => !matches(r, filter));
	}
}

export function createFakeTablesBundle(): TablesBundle {
	return {
		workspaces: new FakeTable<WorkspaceRow>(),
		catalogs: new FakeTable<CatalogRow>(),
		vectorStores: new FakeTable<VectorStoreRow>(),
		documents: new FakeTable<DocumentRow>(),
		apiKeys: new FakeTable<ApiKeyRow>(),
		apiKeyLookup: new FakeTable<ApiKeyLookupRow>(),
	};
}
