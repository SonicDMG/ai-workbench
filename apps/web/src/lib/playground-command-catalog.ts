import type { PlaygroundCommandName } from "@/lib/schemas";

export type PlaygroundTargetKind = "collection" | "table";

export type PlaygroundCommandCategory =
	| "Database"
	| "Read"
	| "Write"
	| "Delete"
	| "Index";

export interface PlaygroundCommandDef {
	readonly id: string;
	readonly name: PlaygroundCommandName;
	readonly targetKind: PlaygroundTargetKind;
	readonly label: string;
	readonly category: PlaygroundCommandCategory;
	readonly description: string;
	readonly requiresTarget: boolean;
}

/*
 * Add new playground samples here.
 *
 * `id` is the UI/sample identity, so it can be unique even when multiple
 * samples use the same raw Data API command. Example: "List table names"
 * and "List table metadata" both send `listTables` with different options.
 *
 * `name` is the exact top-level Data API command key that the runtime
 * validates and sends through `db.command(...)`.
 *
 * `defaultPlaygroundCommand` below owns the editable JSON request body for
 * each sample. Add the command definition here, then add its default JSON
 * case there.
 */
export const PLAYGROUND_COMMANDS_BY_TARGET: Readonly<
	Record<PlaygroundTargetKind, readonly PlaygroundCommandDef[]>
> = {
	collection: [
		{
			id: "collection-list-names",
			name: "findCollections",
			targetKind: "collection",
			label: "List collection names",
			category: "Database",
			description: "List collection names in the selected keyspace.",
			requiresTarget: false,
		},
		{
			id: "collection-list-metadata",
			name: "findCollections",
			targetKind: "collection",
			label: "List collection metadata",
			category: "Database",
			description: "List collection names with their options and metadata.",
			requiresTarget: false,
		},
		{
			id: "collection-create",
			name: "createCollection",
			targetKind: "collection",
			label: "Create collection",
			category: "Database",
			description: "Create a collection with an editable vector definition.",
			requiresTarget: false,
		},
		{
			id: "collection-drop",
			name: "deleteCollection",
			targetKind: "collection",
			label: "Drop collection",
			category: "Delete",
			description: "Drop a collection by name.",
			requiresTarget: false,
		},
		{
			id: "collection-find",
			name: "find",
			targetKind: "collection",
			label: "Find documents",
			category: "Read",
			description: "Find documents in a collection.",
			requiresTarget: true,
		},
		{
			id: "collection-find-one",
			name: "findOne",
			targetKind: "collection",
			label: "Find one document",
			category: "Read",
			description: "Fetch the first document matching a filter.",
			requiresTarget: true,
		},
		{
			id: "collection-distinct",
			name: "distinct",
			targetKind: "collection",
			label: "Find distinct values",
			category: "Read",
			description: "Return distinct values for a document field.",
			requiresTarget: true,
		},
		{
			id: "collection-count",
			name: "countDocuments",
			targetKind: "collection",
			label: "Count documents",
			category: "Read",
			description: "Count documents matching a filter.",
			requiresTarget: true,
		},
		{
			id: "collection-insert-one",
			name: "insertOne",
			targetKind: "collection",
			label: "Insert a document",
			category: "Write",
			description: "Insert one JSON document.",
			requiresTarget: true,
		},
		{
			id: "collection-insert-many",
			name: "insertMany",
			targetKind: "collection",
			label: "Insert documents",
			category: "Write",
			description: "Insert multiple JSON documents.",
			requiresTarget: true,
		},
		{
			id: "collection-update-one",
			name: "updateOne",
			targetKind: "collection",
			label: "Update a document",
			category: "Write",
			description: "Update the first document matching a filter.",
			requiresTarget: true,
		},
		{
			id: "collection-update-many",
			name: "updateMany",
			targetKind: "collection",
			label: "Update documents",
			category: "Write",
			description: "Update all documents matching a filter.",
			requiresTarget: true,
		},
		{
			id: "collection-delete-one",
			name: "deleteOne",
			targetKind: "collection",
			label: "Delete a document",
			category: "Delete",
			description: "Delete the first document matching a filter.",
			requiresTarget: true,
		},
		{
			id: "collection-delete-many",
			name: "deleteMany",
			targetKind: "collection",
			label: "Delete documents",
			category: "Delete",
			description: "Delete all documents matching a filter.",
			requiresTarget: true,
		},
	],
	table: [
		{
			id: "table-list-names",
			name: "listTables",
			targetKind: "table",
			label: "List table names",
			category: "Database",
			description: "List table names in the selected keyspace.",
			requiresTarget: false,
		},
		{
			id: "table-list-metadata",
			name: "listTables",
			targetKind: "table",
			label: "List table metadata",
			category: "Database",
			description: "List table names with schema metadata.",
			requiresTarget: false,
		},
		{
			id: "table-create",
			name: "createTable",
			targetKind: "table",
			label: "Create table",
			category: "Database",
			description: "Create a fixed-schema table with a primary key.",
			requiresTarget: false,
		},
		{
			id: "table-drop",
			name: "dropTable",
			targetKind: "table",
			label: "Drop table",
			category: "Delete",
			description: "Drop a table by name.",
			requiresTarget: false,
		},
		{
			id: "table-list-index-names",
			name: "listIndexes",
			targetKind: "table",
			label: "List index names",
			category: "Index",
			description: "List index names for a table.",
			requiresTarget: true,
		},
		{
			id: "table-list-index-metadata",
			name: "listIndexes",
			targetKind: "table",
			label: "List index metadata",
			category: "Index",
			description: "List indexes with their metadata for a table.",
			requiresTarget: true,
		},
		{
			id: "table-create-index",
			name: "createIndex",
			targetKind: "table",
			label: "Create index",
			category: "Index",
			description: "Create an index for a table column.",
			requiresTarget: true,
		},
		{
			id: "table-drop-index",
			name: "dropIndex",
			targetKind: "table",
			label: "Drop index",
			category: "Index",
			description: "Drop an index from a table.",
			requiresTarget: true,
		},
		{
			id: "table-find",
			name: "find",
			targetKind: "table",
			label: "Find rows",
			category: "Read",
			description: "Find rows in a table.",
			requiresTarget: true,
		},
		{
			id: "table-find-one",
			name: "findOne",
			targetKind: "table",
			label: "Find one row",
			category: "Read",
			description: "Fetch the first row matching a filter.",
			requiresTarget: true,
		},
		{
			id: "table-distinct",
			name: "distinct",
			targetKind: "table",
			label: "Find distinct values",
			category: "Read",
			description: "Return distinct values for a table column.",
			requiresTarget: true,
		},
		{
			id: "table-insert-one",
			name: "insertOne",
			targetKind: "table",
			label: "Insert a row",
			category: "Write",
			description: "Insert one row into a table.",
			requiresTarget: true,
		},
		{
			id: "table-insert-many",
			name: "insertMany",
			targetKind: "table",
			label: "Insert rows",
			category: "Write",
			description: "Insert multiple rows into a table.",
			requiresTarget: true,
		},
		{
			id: "table-update-one",
			name: "updateOne",
			targetKind: "table",
			label: "Update a row",
			category: "Write",
			description: "Update the first row matching a filter.",
			requiresTarget: true,
		},
		{
			id: "table-delete-one",
			name: "deleteOne",
			targetKind: "table",
			label: "Delete a row",
			category: "Delete",
			description: "Delete the first row matching a filter.",
			requiresTarget: true,
		},
		{
			id: "table-delete-many",
			name: "deleteMany",
			targetKind: "table",
			label: "Delete rows",
			category: "Delete",
			description: "Delete all rows matching a filter.",
			requiresTarget: true,
		},
	],
};

export function firstPlaygroundCommandId(
	targetKind: PlaygroundTargetKind,
): string {
	return PLAYGROUND_COMMANDS_BY_TARGET[targetKind][0]?.id ?? "";
}

export function getPlaygroundCommandDef(
	targetKind: PlaygroundTargetKind,
	id: string,
): PlaygroundCommandDef {
	const def = PLAYGROUND_COMMANDS_BY_TARGET[targetKind].find(
		(cmd) => cmd.id === id,
	);
	if (!def) throw new Error(`Unknown playground command: ${targetKind}:${id}`);
	return def;
}

export function defaultPlaygroundCommand(
	id: string,
	targetName: string,
): Record<string, unknown> {
	const target = targetName || "demo_collection";
	const table = targetName || "demo_table";
	switch (id) {
		case "collection-list-names":
			return { findCollections: { options: { explain: false } } };
		case "collection-list-metadata":
			return { findCollections: { options: { explain: true } } };
		case "collection-create":
			return {
				createCollection: {
					name: target,
					options: {
						vector: {
							dimension: 1536,
							metric: "cosine",
						},
					},
				},
			};
		case "collection-drop":
			return { deleteCollection: { name: target } };
		case "collection-find":
			return { find: { filter: {}, options: { limit: 10 } } };
		case "collection-find-one":
			return { findOne: { filter: { _id: "doc-1" } } };
		case "collection-distinct":
			return { distinct: { key: "status", options: { limit: 20 } } };
		case "collection-count":
			return { countDocuments: { filter: {}, upperBound: 1000 } };
		case "collection-insert-one":
			return {
				insertOne: {
					document: {
						_id: "doc-1",
						title: "Hello from AI Workbench",
						status: "draft",
					},
				},
			};
		case "collection-insert-many":
			return {
				insertMany: {
					documents: [
						{ _id: "doc-1", title: "First document" },
						{ _id: "doc-2", title: "Second document" },
					],
				},
			};
		case "collection-update-one":
			return {
				updateOne: {
					filter: { _id: "doc-1" },
					update: { $set: { status: "reviewed" } },
				},
			};
		case "collection-update-many":
			return {
				updateMany: {
					filter: { status: "draft" },
					update: { $set: { status: "reviewed" } },
				},
			};
		case "collection-delete-one":
			return { deleteOne: { filter: { _id: "doc-1" } } };
		case "collection-delete-many":
			return { deleteMany: { filter: { status: "archived" } } };
		case "table-list-names":
			return { listTables: { options: { explain: false } } };
		case "table-list-metadata":
			return { listTables: { options: { explain: true } } };
		case "table-create":
			return {
				createTable: {
					name: table,
					definition: {
						columns: {
							id: "text",
							title: "text",
							rating: "int",
							is_checked_out: "boolean",
						},
						primaryKey: "id",
					},
				},
			};
		case "table-drop":
			return { dropTable: { name: table } };
		case "table-list-index-names":
			return { listIndexes: { options: { explain: false } } };
		case "table-list-index-metadata":
			return { listIndexes: { options: { explain: true } } };
		case "table-create-index":
			return {
				createIndex: {
					name: "idx_title",
					definition: {
						column: "title",
					},
				},
			};
		case "table-drop-index":
			return { dropIndex: { name: "idx_title" } };
		case "table-find":
			return { find: { filter: {}, options: { limit: 10 } } };
		case "table-find-one":
			return { findOne: { filter: { id: "row-1" } } };
		case "table-distinct":
			return { distinct: { key: "rating", options: { limit: 20 } } };
		case "table-insert-one":
			return {
				insertOne: {
					document: {
						id: "row-1",
						title: "Foundation",
						rating: 5,
						is_checked_out: false,
					},
				},
			};
		case "table-insert-many":
			return {
				insertMany: {
					documents: [
						{ id: "row-1", title: "Foundation", rating: 5 },
						{ id: "row-2", title: "Dune", rating: 5 },
					],
				},
			};
		case "table-update-one":
			return {
				updateOne: {
					filter: { id: "row-1" },
					update: { $set: { is_checked_out: true } },
				},
			};
		case "table-delete-one":
			return { deleteOne: { filter: { id: "row-1" } } };
		case "table-delete-many":
			return { deleteMany: { filter: { is_checked_out: true } } };
		default:
			return { find: { filter: {}, options: { limit: 10 } } };
	}
}
