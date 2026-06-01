/**
 * Per-language tests for the Data API Playground code generators.
 *
 * The playground takes a raw single-key command envelope
 * (`{ <op>: { … } }`) and renders an equivalent snippet in
 * TypeScript / Python / Java / cURL. These tests pin:
 *
 *   - the idiomatic SDK call each op maps to (find, insertMany,
 *     createCollection, drop*, index ops, …),
 *   - the generic `db.command(...)` / raw-HTTP fallback used when an
 *     envelope has no idiomatic mapping or no target,
 *   - endpoint resolution (literal workspace URL vs env-var fallback),
 *   - keyspace inclusion/omission,
 *   - and that the token is never embedded as a literal.
 */

import { describe, expect, test } from "vitest";
import { type CodeContext, generatePlaygroundCode } from "./playground-codegen";
import type { Workspace } from "./schemas";

const astraWorkspace: Workspace = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	name: "research-lab",
	url: "https://db-1234.apps.astra.datastax.com",
	kind: "astra",
	credentials: {},
	keyspace: "default_keyspace",
	rlacEnabled: false,
	createdAt: "2026-04-01T00:00:00.000Z",
	updatedAt: "2026-04-01T00:00:00.000Z",
};

function ctx(overrides: Partial<CodeContext> = {}): CodeContext {
	return {
		workspace: astraWorkspace,
		command: { findCollections: {} },
		targetKind: "collection",
		targetName: "wb_vectors",
		...overrides,
	};
}

describe("playground-codegen — preamble + endpoint resolution", () => {
	test("typescript embeds the literal workspace URL and env-resolved token", () => {
		const code = generatePlaygroundCode("typescript", ctx());
		expect(code).toContain(
			'import { DataAPIClient } from "@datastax/astra-db-ts";',
		);
		expect(code).toContain("const client = new DataAPIClient();");
		expect(code).toContain(
			'const db = client.db("https://db-1234.apps.astra.datastax.com", {',
		);
		expect(code).toContain("token: process.env.ASTRA_DB_APPLICATION_TOKEN!,");
		expect(code).toContain('keyspace: "default_keyspace",');
		// Never embed a token literal.
		expect(code).not.toContain("AstraCS:");
	});

	test("python preamble uses astrapy + env token, literal URL", () => {
		const code = generatePlaygroundCode("python", ctx());
		expect(code).toContain("from astrapy import DataAPIClient");
		expect(code).toContain("client = DataAPIClient()");
		expect(code).toContain('"https://db-1234.apps.astra.datastax.com",');
		expect(code).toContain('token=os.environ["ASTRA_DB_APPLICATION_TOKEN"],');
		expect(code).toContain('keyspace="default_keyspace",');
	});

	test("java preamble builds DatabaseOptions with env token + literal URL", () => {
		const code = generatePlaygroundCode("java", ctx());
		expect(code).toContain(
			"DataAPIClient client = new DataAPIClient(new DataAPIClientOptions());",
		);
		expect(code).toContain('System.getenv("ASTRA_DB_APPLICATION_TOKEN"),');
		expect(code).toContain(
			'Database db = client.getDatabase("https://db-1234.apps.astra.datastax.com", dbOptions);',
		);
		expect(code).toContain('dbOptions.keyspace("default_keyspace");');
	});

	test("falls back to env-var endpoint when the workspace URL is not literal", () => {
		const noUrl = ctx({ workspace: { ...astraWorkspace, url: null } });
		expect(generatePlaygroundCode("typescript", noUrl)).toContain(
			"process.env.ASTRA_DB_API_ENDPOINT!",
		);
		expect(generatePlaygroundCode("python", noUrl)).toContain(
			'os.environ["ASTRA_DB_API_ENDPOINT"]',
		);
		expect(generatePlaygroundCode("java", noUrl)).toContain(
			'System.getenv("ASTRA_DB_API_ENDPOINT")',
		);
		expect(generatePlaygroundCode("curl", noUrl)).toContain(
			"$ASTRA_DB_API_ENDPOINT",
		);
	});

	test("omits keyspace cleanly when the workspace has none", () => {
		const noKs = ctx({ workspace: { ...astraWorkspace, keyspace: null } });
		expect(generatePlaygroundCode("typescript", noKs)).not.toContain(
			"keyspace:",
		);
		expect(generatePlaygroundCode("python", noKs)).not.toContain("keyspace=");
		expect(generatePlaygroundCode("java", noKs)).not.toContain(
			"dbOptions.keyspace(",
		);
		const curl = generatePlaygroundCode("curl", noKs);
		// No empty keyspace path segment.
		expect(curl).not.toContain("/v1//");
	});
});

describe("playground-codegen — TypeScript idiomatic mappings", () => {
	test("findCollections → listCollections (nameOnly), explain flips to full", () => {
		expect(
			generatePlaygroundCode(
				"typescript",
				ctx({ command: { findCollections: {} } }),
			),
		).toContain("await db.listCollections({ nameOnly: true })");
		const explained = generatePlaygroundCode(
			"typescript",
			ctx({ command: { findCollections: { options: { explain: true } } } }),
		);
		expect(explained).toContain("await db.listCollections();");
		expect(explained).not.toContain("nameOnly");
	});

	test("createCollection emits db.createCollection with options", () => {
		const code = generatePlaygroundCode(
			"typescript",
			ctx({
				command: {
					createCollection: {
						name: "wb_vectors",
						options: { vector: { dimension: 1536 } },
					},
				},
			}),
		);
		expect(code).toContain('db.createCollection("wb_vectors"');
		expect(code).toContain('"dimension": 1536');
	});

	test("find on a collection handle filters + options", () => {
		const code = generatePlaygroundCode(
			"typescript",
			ctx({
				command: {
					find: { filter: { city: "NYC" }, options: { limit: 5 } },
				},
				targetName: "places",
			}),
		);
		expect(code).toContain('const collection = db.collection("places");');
		expect(code).toContain('await collection.find({\n  "city": "NYC"\n}, {');
		expect(code).toContain('"limit": 5');
		expect(code).toContain(".toArray()");
	});

	test("find on a table handle uses db.table + table receiver", () => {
		const code = generatePlaygroundCode(
			"typescript",
			ctx({
				command: { find: { filter: {} } },
				targetKind: "table",
				targetName: "demo_table",
			}),
		);
		expect(code).toContain('const table = db.table("demo_table");');
		expect(code).toContain("await table.find(");
	});

	test("countDocuments defaults the upper bound to 1000", () => {
		const code = generatePlaygroundCode(
			"typescript",
			ctx({
				command: { countDocuments: { filter: {} } },
				targetName: "places",
			}),
		);
		expect(code).toContain("countDocuments(");
		expect(code).toContain(", 1000)");
	});

	test("createIndex with a string column uses the shorthand overload", () => {
		const code = generatePlaygroundCode(
			"typescript",
			ctx({
				command: {
					createIndex: { name: "idx_city", definition: { column: "city" } },
				},
				targetName: "places",
			}),
		);
		expect(code).toContain('await collection.createIndex("idx_city", "city");');
	});
});

describe("playground-codegen — Python idiomatic mappings", () => {
	test("findCollections → list_collection_names", () => {
		const code = generatePlaygroundCode(
			"python",
			ctx({ command: { findCollections: {} } }),
		);
		expect(code).toContain("names = database.list_collection_names()");
	});

	test("createCollection emits create_collection with a definition dict", () => {
		const code = generatePlaygroundCode(
			"python",
			ctx({
				command: {
					createCollection: {
						name: "wb_vectors",
						options: { vector: { dimension: 1536 } },
					},
				},
			}),
		);
		expect(code).toContain("database.create_collection(");
		expect(code).toContain('"dimension": 1536');
	});

	test("find converts camelCase options into snake_case kwargs", () => {
		const code = generatePlaygroundCode(
			"python",
			ctx({
				command: { find: { filter: {}, options: { includeSimilarity: true } } },
				targetName: "places",
			}),
		);
		expect(code).toContain('collection = database.get_collection("places")');
		expect(code).toContain("include_similarity=True");
	});

	test("insert_many renders a Python list of dicts", () => {
		const code = generatePlaygroundCode(
			"python",
			ctx({
				command: { insertMany: { documents: [{ a: 1 }, { b: 2 }] } },
				targetName: "places",
			}),
		);
		expect(code).toContain("result = collection.insert_many([");
		expect(code).toContain('"a": 1');
		expect(code).toContain('"b": 2');
	});

	test("booleans and null map to Python literals", () => {
		const code = generatePlaygroundCode(
			"python",
			ctx({
				command: { insertOne: { document: { active: true, note: null } } },
				targetName: "places",
			}),
		);
		expect(code).toContain('"active": True');
		expect(code).toContain('"note": None');
	});
});

describe("playground-codegen — Java idiomatic mappings", () => {
	test("findCollections → listCollectionNames", () => {
		const code = generatePlaygroundCode(
			"java",
			ctx({ command: { findCollections: {} } }),
		);
		expect(code).toContain(
			"db.listCollectionNames().forEach(System.out::println);",
		);
	});

	test("find parses a Document filter and only imports what it uses", () => {
		const code = generatePlaygroundCode(
			"java",
			ctx({
				command: { find: { filter: { city: "NYC" } } },
				targetName: "places",
			}),
		);
		expect(code).toContain(
			'Collection<Document> collection = db.getCollection("places");',
		);
		expect(code).toContain("Document filter = Document.parse(");
		expect(code).toContain(
			"collection.find(filter).forEach(System.out::println);",
		);
		// Conditional imports present for the tokens the snippet uses…
		expect(code).toContain(
			"import com.datastax.astra.client.collections.Collection;",
		);
		expect(code).toContain(
			"import com.datastax.astra.client.collections.definition.documents.Document;",
		);
		// …and absent for tokens it does not (no Table/Row/List here).
		expect(code).not.toContain(
			"import com.datastax.astra.client.tables.Table;",
		);
		expect(code).not.toContain("import java.util.List;");
	});

	test("insertMany pulls in the List import + builds a List.of(...)", () => {
		const code = generatePlaygroundCode(
			"java",
			ctx({
				command: { insertMany: { documents: [{ a: 1 }] } },
				targetName: "places",
			}),
		);
		expect(code).toContain("import java.util.List;");
		expect(code).toContain(
			"List<Document> documents = List.of(Document.parse(",
		);
		expect(code).toContain("collection.insertMany(documents)");
	});

	test("table find uses Table<Row> handle + Row docType", () => {
		const code = generatePlaygroundCode(
			"java",
			ctx({
				command: { find: { filter: {} } },
				targetKind: "table",
				targetName: "demo_table",
			}),
		);
		expect(code).toContain('Table<Row> table = db.getTable("demo_table");');
		expect(code).toContain("Row filter = Row.parse(");
		expect(code).toContain("import com.datastax.astra.client.tables.Table;");
		expect(code).toContain(
			"import com.datastax.astra.client.tables.definition.rows.Row;",
		);
	});
});

describe("playground-codegen — cURL", () => {
	test("posts to the keyspace + target path with env token and JSON body", () => {
		const code = generatePlaygroundCode(
			"curl",
			ctx({ command: { find: { filter: {} } }, targetName: "places" }),
		);
		expect(code).toContain("curl -sS -X POST");
		expect(code).toContain(
			'"https://db-1234.apps.astra.datastax.com/api/json/v1/default_keyspace/places"',
		);
		expect(code).toContain('-H "Token: $ASTRA_DB_APPLICATION_TOKEN"');
		expect(code).toContain('"find"');
	});

	test("drops the target segment when there is no target", () => {
		const code = generatePlaygroundCode(
			"curl",
			ctx({ command: { findCollections: {} }, targetName: null }),
		);
		expect(code).toContain("/api/json/v1/default_keyspace");
		expect(code).not.toContain("/default_keyspace/");
	});

	test("trims a trailing slash from a literal workspace URL", () => {
		const code = generatePlaygroundCode(
			"curl",
			ctx({
				workspace: {
					...astraWorkspace,
					url: "https://db-1234.apps.astra.datastax.com/",
				},
				targetName: null,
			}),
		);
		expect(code).toContain(
			'"https://db-1234.apps.astra.datastax.com/api/json/v1/default_keyspace"',
		);
		expect(code).not.toContain(".com//api");
	});

	test("shell-escapes single quotes in the JSON body", () => {
		const code = generatePlaygroundCode(
			"curl",
			ctx({
				command: { find: { filter: { name: "O'Hara" } } },
				targetName: "places",
			}),
		);
		expect(code).toContain("O'\\''Hara");
	});
});

describe("playground-codegen — generic fallback", () => {
	test("typescript falls back to db.command for a multi-key envelope", () => {
		const code = generatePlaygroundCode(
			"typescript",
			ctx({ command: { foo: {}, bar: {} }, targetName: "places" }),
		);
		expect(code).toContain("const command = {");
		expect(code).toContain("await db.command(command");
		expect(code).toContain('{ collection: "places" }');
	});

	test("python falls back to database.command with a JSON-loaded envelope", () => {
		const code = generatePlaygroundCode(
			"python",
			ctx({ command: { foo: {}, bar: {} }, targetName: "places" }),
		);
		expect(code).toContain("import json");
		expect(code).toContain("command = json.loads(");
		expect(code).toContain(
			'result = database.command(command, collection_name="places")',
		);
	});

	test("java falls back to a raw HttpClient POST for an unmapped envelope", () => {
		const code = generatePlaygroundCode(
			"java",
			ctx({ command: { foo: {}, bar: {} }, targetName: "places" }),
		);
		expect(code).toContain("import java.net.http.HttpClient;");
		expect(code).toContain('String target = "places";');
		expect(code).toContain("HttpRequest.newBuilder(");
		expect(code).toContain(
			'.header("Token", System.getenv("ASTRA_DB_APPLICATION_TOKEN"))',
		);
	});

	test("an op needing a target falls back when no target is given", () => {
		// `find` is target-scoped; without a target the idiomatic path
		// bails and the generic command form is emitted instead.
		const code = generatePlaygroundCode(
			"typescript",
			ctx({ command: { find: { filter: {} } }, targetName: null }),
		);
		expect(code).toContain("await db.command(command)");
		expect(code).not.toContain("collection.find(");
	});
});
