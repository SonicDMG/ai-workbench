/**
 * Adapts `@datastax/astra-db-ts` to the {@link TablesBundle} shape used
 * by the astra control-plane store.
 *
 * Creates (idempotently) each of the four `wb_*` tables at init time,
 * then returns a bundle of typed accessors — the rest of the runtime
 * never touches the raw `Db` object.
 */

import { DataAPIClient, type Db } from "@datastax/astra-db-ts";
import type {
	CatalogRow,
	DocumentRow,
	VectorStoreRow,
	WorkspaceRow,
} from "./row-types.js";
import {
	CATALOGS_DEFINITION,
	CATALOGS_TABLE,
	DOCUMENTS_DEFINITION,
	DOCUMENTS_TABLE,
	VECTOR_STORES_DEFINITION,
	VECTOR_STORES_TABLE,
	WORKSPACES_DEFINITION,
	WORKSPACES_TABLE,
} from "./table-definitions.js";
import type { TablesBundle } from "./tables.js";

export interface AstraClientConfig {
	readonly endpoint: string;
	readonly token: string;
	readonly keyspace: string;
}

/**
 * Open a Data API connection, ensure the four `wb_*` tables exist,
 * and return a {@link TablesBundle} backed by real astra-db-ts tables.
 *
 * Idempotent — safe to call on every process start. Table creation
 * uses `ifNotExists: true` so existing schemas aren't touched.
 */
export async function openAstraClient(
	config: AstraClientConfig,
): Promise<TablesBundle> {
	const client = new DataAPIClient(config.token);
	const db = client.db(config.endpoint, { keyspace: config.keyspace });

	await ensureTables(db);

	return {
		workspaces: db.table<WorkspaceRow>(WORKSPACES_TABLE),
		catalogs: db.table<CatalogRow>(CATALOGS_TABLE),
		vectorStores: db.table<VectorStoreRow>(VECTOR_STORES_TABLE),
		documents: db.table<DocumentRow>(DOCUMENTS_TABLE),
	};
}

async function ensureTables(db: Db): Promise<void> {
	await Promise.all([
		db.createTable(WORKSPACES_TABLE, {
			definition: WORKSPACES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(CATALOGS_TABLE, {
			definition: CATALOGS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(VECTOR_STORES_TABLE, {
			definition: VECTOR_STORES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(DOCUMENTS_TABLE, {
			definition: DOCUMENTS_DEFINITION,
			ifNotExists: true,
		}),
	]);
}
