/**
 * Shared SQLite-backed state for {@link ./store.SqliteControlPlaneStore}.
 *
 * The SQLite backend exists for chat-heavy / durable single-node
 * deployments where the {@link ../file/store.FileControlPlaneStore}'s
 * whole-file-rewrite-per-mutation becomes quadratic under streaming
 * chat load (every appended message rewrites the entire `messages.json`).
 *
 * **Design — reuse the file slices verbatim.** Every file aggregate
 * slice (`../file/workspaces.ts`, `../file/chat-messages.ts`, …) is
 * written purely against the {@link ../file/state.FileStoreState} seam:
 * `readAll(table)` + `mutate(table, fn)` plus the cross-aggregate
 * `assert*` helpers (which themselves only call `readAll`). This module
 * implements that exact seam on top of SQLite, so `./store.ts` composes
 * the unmodified file slices over a SQLite-backed state and inherits all
 * of their business logic (conflict checks, cascades, normalization,
 * ordering) with zero duplication.
 *
 * **Storage model.** One physical table per logical {@link Table}. Each
 * row is `(seq INTEGER PRIMARY KEY AUTOINCREMENT, pk TEXT UNIQUE, data
 * TEXT)` where `data` is the JSON-serialized record and `pk` is the
 * record's composite logical key. `readAll` returns rows ordered by
 * `seq ASC`, which reproduces the file backend's JSON-array order for
 * append-based slices (`[...rows, record]`); `mutate` diffs the
 * slice-returned `nextRows` against the prior rows by `pk` and issues
 * only the necessary row-level INSERT / UPDATE / DELETE inside a single
 * transaction — the whole point of this backend. The rare slice that
 * reorders (policy-audit's prepend) is detected and triggers a `seq`
 * renumber so read order still matches the array the slice produced.
 *
 * Like the file backend this is single-node only: WAL gives durable,
 * crash-safe writes and one-writer/many-reader concurrency within the
 * process, but cross-process multi-writer coordination is the astra
 * backend's job.
 */

import type DatabaseConstructor from "better-sqlite3";
import type { FileStoreState, Table, TableRow } from "../file/state.js";
import { TABLE_FILES } from "../file/state.js";

/** Concrete row stored in SQLite — surrogate `seq`, logical `pk`, JSON `data`. */
interface StoredRow {
	readonly seq: number;
	readonly pk: string;
	readonly data: string;
}

/**
 * Physical table name for a logical {@link Table}. Derived from the
 * file backend's `<table>.json` filename so the two backends stay in
 * lockstep: dropping the `.json` and swapping hyphens for underscores
 * yields a valid SQLite identifier.
 */
function physicalTable(table: Table): string {
	return TABLE_FILES[table].replace(/\.json$/, "").replace(/-/g, "_");
}

/**
 * Composite logical primary key for a record in `table`. Mirrors the
 * `(workspace, …)` tuples the file slices match on. The exact field
 * set per table is what makes the row-level diff in {@link mutate}
 * correct — two records collide iff they'd collide in the file
 * backend's in-array identity checks.
 */
function primaryKeyOf(table: Table, row: Record<string, unknown>): string {
	const parts = ((): readonly unknown[] => {
		switch (table) {
			case "workspaces":
				return [row.uid];
			case "api-keys":
				// (workspace, keyId) is the addressable identity; `prefix`
				// uniqueness is enforced by the slice, not the PK.
				return [row.workspace, row.keyId];
			case "knowledge-bases":
				return [row.workspaceId, row.knowledgeBaseId];
			case "knowledge-filters":
				return [row.workspaceId, row.knowledgeBaseId, row.knowledgeFilterId];
			case "chunking-services":
				return [row.workspaceId, row.chunkingServiceId];
			case "embedding-services":
				return [row.workspaceId, row.embeddingServiceId];
			case "reranking-services":
				return [row.workspaceId, row.rerankingServiceId];
			case "llm-services":
				return [row.workspaceId, row.llmServiceId];
			case "rag-documents":
				return [row.workspaceId, row.knowledgeBaseId, row.documentId];
			case "agents":
				return [row.workspaceId, row.agentId];
			case "conversations":
				return [row.workspaceId, row.agentId, row.conversationId];
			case "messages":
				return [row.workspaceId, row.conversationId, row.messageId];
			case "principals":
				return [row.workspaceId, row.principalId];
			case "mcp-servers":
				return [row.workspaceId, row.mcpServerId];
			case "policy-audit":
				// Append-only; `decisionId` is a freshly minted UUID per row.
				return [row.decisionId];
			default: {
				const exhaustive: never = table;
				throw new Error(`unknown table: ${String(exhaustive)}`);
			}
		}
	})();
	// Join with a NUL separator: it can't appear in any UUID, id, or
	// name we store, so distinct key tuples can never collide by
	// concatenation. Written as an explicit \u0000 escape so the
	// source stays plain ASCII (a literal NUL byte makes git treat
	// the file as binary, which breaks diffs and squash-merges).
	return parts.map((p) => String(p)).join("\u0000");
}

const ALL_TABLES: readonly Table[] = Object.keys(TABLE_FILES) as Table[];

/**
 * Create every physical table if absent. Idempotent — safe to call on
 * each open. `seq` is an explicit `INTEGER PRIMARY KEY` so it aliases
 * SQLite's rowid and increases monotonically on INSERT, giving us
 * insertion order for free.
 */
function ensureSchema(db: DatabaseConstructor.Database): void {
	for (const table of ALL_TABLES) {
		const phys = physicalTable(table);
		db.exec(
			`CREATE TABLE IF NOT EXISTS "${phys}" (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				pk TEXT NOT NULL UNIQUE,
				data TEXT NOT NULL
			)`,
		);
	}
}

/**
 * SQLite implementation of the {@link FileStoreState} seam. Structurally
 * a `FileStoreState`, so it drops straight into the file aggregate
 * slices. Carries no in-memory record maps — every read hits SQLite,
 * every write goes through the row-level diff in {@link mutate}.
 */
export interface SqliteStoreState extends FileStoreState {
	/** The underlying connection — exposed so the store can `close()` it. */
	readonly db: DatabaseConstructor.Database;
}

/**
 * Build a {@link SqliteStoreState} over an already-open connection.
 * Applies the standard durable-but-fast single-node pragmas (WAL +
 * `synchronous = NORMAL` + a `busy_timeout` so a momentarily-locked
 * writer retries instead of throwing) and creates the schema. SQL
 * foreign keys are deliberately left off — relationships and cascades
 * are modeled in the (shared) slice layer, exactly as the file backend
 * does, so the two backends behave identically.
 *
 * The caller owns connection lifecycle: `./store.ts` opens the file (or
 * `:memory:`) database, hands it here, and closes it on `close()`.
 */
export function createSqliteStoreState(
	db: DatabaseConstructor.Database,
): SqliteStoreState {
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("busy_timeout = 5000");
	ensureSchema(db);

	function readStored(table: Table): readonly StoredRow[] {
		const phys = physicalTable(table);
		return db
			.prepare(`SELECT seq, pk, data FROM "${phys}" ORDER BY seq ASC`)
			.all() as StoredRow[];
	}

	function readAll<K extends Table>(table: K): Promise<TableRow<K>[]> {
		const rows = readStored(table).map(
			(r) => JSON.parse(r.data) as TableRow<K>,
		);
		return Promise.resolve(rows);
	}

	function mutate<K extends Table, R>(
		table: K,
		fn: (rows: ReadonlyArray<TableRow<K>>) => {
			rows: readonly TableRow<K>[];
			result: R;
		},
	): Promise<R> {
		const phys = physicalTable(table);
		// `better-sqlite3` is synchronous, so the whole read-modify-write
		// runs inside one SQLite transaction with no interleaving — the
		// same atomicity the file backend gets from its per-table mutex,
		// but enforced by the engine.
		const run = db.transaction((): R => {
			const stored = readStored(table);
			const before = stored.map((r) => JSON.parse(r.data) as TableRow<K>);
			const { rows: after, result } = fn(before);

			const beforeByPk = new Map<string, StoredRow>();
			for (const r of stored) beforeByPk.set(r.pk, r);

			const afterByPk = new Map<string, string>();
			const afterPkOrder: string[] = [];
			for (const row of after) {
				const pk = primaryKeyOf(
					table,
					row as unknown as Record<string, unknown>,
				);
				afterByPk.set(pk, JSON.stringify(row));
				afterPkOrder.push(pk);
			}

			// Deletes: anything present before but absent after.
			const del = db.prepare(`DELETE FROM "${phys}" WHERE pk = ?`);
			for (const r of stored) {
				if (!afterByPk.has(r.pk)) del.run(r.pk);
			}

			if (needsRenumber(stored, afterPkOrder)) {
				// A reordering slice (only policy-audit's prepend today):
				// the surviving rows no longer line up with stored `seq`
				// order. Clear and re-insert in array order so a later
				// `readAll` (ORDER BY seq) reproduces exactly what the slice
				// returned. Bounded tables only — never the hot message path.
				db.prepare(`DELETE FROM "${phys}"`).run();
				const ins = db.prepare(
					`INSERT INTO "${phys}" (pk, data) VALUES (?, ?)`,
				);
				for (const pk of afterPkOrder) {
					ins.run(pk, afterByPk.get(pk) as string);
				}
			} else {
				// Fast path: appends + in-place updates preserve order.
				// New rows INSERT at the tail (monotonic seq); changed rows
				// UPDATE in place; untouched rows are not written at all —
				// this is the whole-file-rewrite avoidance.
				const ins = db.prepare(
					`INSERT INTO "${phys}" (pk, data) VALUES (?, ?)`,
				);
				const upd = db.prepare(`UPDATE "${phys}" SET data = ? WHERE pk = ?`);
				for (const pk of afterPkOrder) {
					const data = afterByPk.get(pk) as string;
					const prior = beforeByPk.get(pk);
					if (!prior) {
						ins.run(pk, data);
					} else if (prior.data !== data) {
						upd.run(data, pk);
					}
				}
			}

			return result;
		});
		return Promise.resolve(run());
	}

	return {
		// `root` is part of the FileStoreState shape (the file backend
		// uses it for its directory); the SQLite backend keys off the
		// connection instead, so this is a stable label, never a path.
		root: "sqlite",
		// The per-table mutex map the file backend exposes is unused here:
		// SQLite transactions provide the read-modify-write atomicity, so
		// the slices never touch `state.mutexes` (they only call `mutate`).
		// An empty object satisfies the structural type without allocating
		// real locks we'd never acquire.
		mutexes: {} as FileStoreState["mutexes"],
		readAll,
		mutate,
		db,
	};
}

/**
 * Decide whether the surviving rows still line up with stored insertion
 * order. Returns `false` (fast path) when the after-image is the
 * before-image with deletions and tail-appends only — i.e. the
 * subsequence of retained pks appears in the same relative order in both
 * `stored` and `after`, and every brand-new pk sits after the last
 * retained one. Any other shape (a prepend, an interleave) returns
 * `true`, forcing a `seq` renumber.
 */
function needsRenumber(
	stored: readonly StoredRow[],
	afterPkOrder: readonly string[],
): boolean {
	const storedPkSet = new Set(stored.map((r) => r.pk));
	// Retained pks, in the order the slice put them in the after-image.
	const retainedAfter = afterPkOrder.filter((pk) => storedPkSet.has(pk));
	// Retained pks, in stored (seq) order.
	const afterPkSet = new Set(afterPkOrder);
	const retainedStored = stored
		.map((r) => r.pk)
		.filter((pk) => afterPkSet.has(pk));
	if (retainedAfter.length !== retainedStored.length) return true;
	for (let i = 0; i < retainedAfter.length; i++) {
		if (retainedAfter[i] !== retainedStored[i]) return true;
	}
	// Relative order of survivors matches. New rows must all come after
	// the final retained row for the fast path to keep read order intact.
	const lastRetainedIdx = lastIndexOfRetained(afterPkOrder, storedPkSet);
	for (let i = 0; i < afterPkOrder.length; i++) {
		const isNew = !storedPkSet.has(afterPkOrder[i] as string);
		if (isNew && i < lastRetainedIdx) return true;
	}
	return false;
}

function lastIndexOfRetained(
	afterPkOrder: readonly string[],
	storedPkSet: ReadonlySet<string>,
): number {
	for (let i = afterPkOrder.length - 1; i >= 0; i--) {
		if (storedPkSet.has(afterPkOrder[i] as string)) return i;
	}
	return -1;
}

/*
 * Note on cross-aggregate assertions: the file slices import their
 * `assert*` helpers (`assertWorkspace`, `assertChat`, …) directly from
 * `../file/state.js` and call them with the `state` they were handed.
 * Those helpers only touch `state.readAll`, so they work unmodified
 * against this SQLite state — there is nothing to re-implement or
 * re-export here.
 */
