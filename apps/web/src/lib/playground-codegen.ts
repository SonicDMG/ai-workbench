/**
 * Client-code generators for the Data API Playground
 * (`pages/PlaygroundPage.tsx`). Given a raw Data API command envelope
 * — the single-key `{ <op>: { … } }` JSON the user edits in the
 * playground textarea — these emitters render an equivalent,
 * copy-pasteable snippet in one of four languages:
 *
 *   - **TypeScript** with `@datastax/astra-db-ts`
 *   - **Python**     with `astrapy`
 *   - **Java**       with `com.datastax.astra:astra-db-java`
 *   - **cURL**       against the Data API
 *
 * Where a command maps onto an idiomatic SDK call (`find`,
 * `insertMany`, `createCollection`, …) the generator emits that call;
 * otherwise it falls back to the generic `db.command(...)` /
 * raw-HTTP form so any envelope still produces runnable code.
 *
 * The endpoint is taken from the workspace when it is a literal URL,
 * otherwise it falls back to the `ASTRA_DB_API_ENDPOINT` env var. The
 * token is always env-resolved — never embedded in the snippet.
 *
 * String escapers (`jsString` / `pyString` / `javaString` /
 * `escapeCurlBody`) are shared with `./astra-codegen` so both
 * code-generation surfaces escape literals identically.
 */

import type { CodeLanguage } from "./astra-codegen";
import {
	escapeCurlBody,
	javaString,
	jsString,
	pyString,
} from "./astra-codegen";
import type { PlaygroundTargetKind } from "./playground-command-catalog";
import type { Workspace } from "./schemas";

export interface CodeContext {
	readonly workspace: Workspace;
	readonly command: Record<string, unknown>;
	readonly targetKind: PlaygroundTargetKind;
	readonly targetName: string | null;
}

export function generatePlaygroundCode(
	language: CodeLanguage,
	ctx: CodeContext,
): string {
	switch (language) {
		case "typescript":
			return generateTypeScript(ctx);
		case "python":
			return generatePython(ctx);
		case "java":
			return generateJava(ctx);
		case "curl":
			return generateCurl(ctx);
	}
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

interface ExtractedCommand {
	readonly op: string;
	readonly body: Record<string, unknown>;
}

function extractCommand(
	command: Record<string, unknown>,
): ExtractedCommand | null {
	const keys = Object.keys(command);
	if (keys.length !== 1) return null;
	const op = keys[0];
	if (!op) return null;
	const body = command[op];
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return null;
	}
	return { op, body: body as Record<string, unknown> };
}

function explainFlag(body: Record<string, unknown>): boolean {
	const options = body.options;
	if (options && typeof options === "object" && !Array.isArray(options)) {
		return (options as Record<string, unknown>).explain === true;
	}
	return false;
}

function typeScriptDbSetup(endpoint: string, keyspace: string | null): string {
	const optionLines = ["token: process.env.ASTRA_DB_APPLICATION_TOKEN!,"];
	if (keyspace) optionLines.push(`keyspace: ${jsString(keyspace)},`);
	return `const client = new DataAPIClient();
const db = client.db(${endpoint}, {
  ${optionLines.join("\n  ")}
});`;
}

function pythonDbSetup(endpoint: string, keyspace: string | null): string {
	const keyspaceLine = keyspace ? `\n    keyspace=${pyString(keyspace)},` : "";
	return `client = DataAPIClient()
database = client.get_database(
    ${endpoint},
    token=os.environ["ASTRA_DB_APPLICATION_TOKEN"],${keyspaceLine}
)`;
}

function javaDbSetup(endpoint: string, keyspace: string | null): string {
	const keyspaceLine = keyspace
		? `\ndbOptions.keyspace(${javaString(keyspace)});`
		: "";
	return `DataAPIClient client = new DataAPIClient(new DataAPIClientOptions());
DatabaseOptions dbOptions = new DatabaseOptions(
    System.getenv("ASTRA_DB_APPLICATION_TOKEN"),
    new DataAPIClientOptions());${keyspaceLine}
Database db = client.getDatabase(${endpoint}, dbOptions);`;
}

function indentLines(value: string, indent: string): string {
	return value
		.split("\n")
		.map((line) => (line.length > 0 ? `${indent}${line}` : line))
		.join("\n");
}

function generateTypeScript({
	workspace,
	command,
	targetKind,
	targetName,
}: CodeContext) {
	const endpoint = endpointForCode(workspace, "typescript");
	const preamble = `import { DataAPIClient } from "@datastax/astra-db-ts";

${typeScriptDbSetup(endpoint, workspace.keyspace)}
`;

	const snippet = idiomaticTypeScript(command, targetKind, targetName);
	if (snippet) {
		return `${preamble}\n${snippet}\n`;
	}

	const optionsArg = targetName
		? `, { ${targetKind}: ${jsString(targetName)} }`
		: "";
	return `${preamble}
const command = ${formatJson(command)} as const;
const result = await db.command(command${optionsArg});
console.log(result);
`;
}

function idiomaticTypeScript(
	command: Record<string, unknown>,
	targetKind: PlaygroundTargetKind,
	targetName: string | null,
): string | null {
	const extracted = extractCommand(command);
	if (!extracted) return null;
	const { op, body } = extracted;
	const name = typeof body.name === "string" ? body.name : "";

	switch (op) {
		case "findCollections": {
			return explainFlag(body)
				? `const collections = await db.listCollections();
console.log(collections);`
				: `const names = await db.listCollections({ nameOnly: true });
console.log(names);`;
		}
		case "createCollection": {
			const options = body.options;
			const optionsArg =
				options && typeof options === "object"
					? `, ${formatJson(options)}`
					: "";
			return `const collection = await db.createCollection(${jsString(name)}${optionsArg});
console.log(collection.name);`;
		}
		case "deleteCollection": {
			return `await db.dropCollection(${jsString(name)});
console.log("Dropped ${name}");`;
		}
		case "listTables": {
			return explainFlag(body)
				? `const tables = await db.listTables();
console.log(tables);`
				: `const names = await db.listTables({ nameOnly: true });
console.log(names);`;
		}
		case "createTable": {
			const definition = body.definition ?? {};
			return `const table = await db.createTable(${jsString(name)}, {
  definition: ${formatJson(definition)},
});
console.log(table.name);`;
		}
		case "dropTable": {
			return `await db.dropTable(${jsString(name)});
console.log("Dropped ${name}");`;
		}
		case "dropIndex": {
			return `await db.dropTableIndex(${jsString(name)});
console.log("Dropped index ${name}");`;
		}
	}

	if (!targetName) return null;
	const handle =
		targetKind === "table"
			? `const table = db.table(${jsString(targetName)});`
			: `const collection = db.collection(${jsString(targetName)});`;
	const receiver = targetKind === "table" ? "table" : "collection";

	switch (op) {
		case "find": {
			const filter = body.filter ?? {};
			const options = body.options;
			const optionsArg =
				options && typeof options === "object"
					? `, ${formatJson(options)}`
					: "";
			return `${handle}
const rows = await ${receiver}.find(${formatJson(filter)}${optionsArg}).toArray();
console.log(rows);`;
		}
		case "findOne": {
			const filter = body.filter ?? {};
			const options = body.options;
			const optionsArg =
				options && typeof options === "object"
					? `, ${formatJson(options)}`
					: "";
			return `${handle}
const row = await ${receiver}.findOne(${formatJson(filter)}${optionsArg});
console.log(row);`;
		}
		case "distinct": {
			const key = typeof body.key === "string" ? body.key : "";
			const filter = body.filter ?? {};
			return `${handle}
const values = await ${receiver}.distinct(${jsString(key)}, ${formatJson(filter)});
console.log(values);`;
		}
		case "countDocuments": {
			const filter = body.filter ?? {};
			const upper =
				typeof body.upperBound === "number" ? body.upperBound : 1000;
			return `${handle}
const total = await ${receiver}.countDocuments(${formatJson(filter)}, ${upper});
console.log(total);`;
		}
		case "insertOne": {
			const document = body.document ?? {};
			return `${handle}
const result = await ${receiver}.insertOne(${formatJson(document)});
console.log(result);`;
		}
		case "insertMany": {
			const documents = body.documents ?? [];
			return `${handle}
const result = await ${receiver}.insertMany(${formatJson(documents)});
console.log(result);`;
		}
		case "updateOne": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
const result = await ${receiver}.updateOne(${formatJson(filter)}, ${formatJson(update)});
console.log(result);`;
		}
		case "updateMany": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
const result = await ${receiver}.updateMany(${formatJson(filter)}, ${formatJson(update)});
console.log(result);`;
		}
		case "deleteOne": {
			const filter = body.filter ?? {};
			return `${handle}
const result = await ${receiver}.deleteOne(${formatJson(filter)});
console.log(result);`;
		}
		case "deleteMany": {
			const filter = body.filter ?? {};
			return `${handle}
const result = await ${receiver}.deleteMany(${formatJson(filter)});
console.log(result);`;
		}
		case "listIndexes": {
			return explainFlag(body)
				? `${handle}
const indexes = await ${receiver}.listIndexes();
console.log(indexes);`
				: `${handle}
const names = await ${receiver}.listIndexes({ nameOnly: true });
console.log(names);`;
		}
		case "createIndex": {
			const definition = body.definition;
			if (
				definition &&
				typeof definition === "object" &&
				!Array.isArray(definition) &&
				typeof (definition as Record<string, unknown>).column === "string"
			) {
				const column = (definition as Record<string, unknown>).column as string;
				return `${handle}
await ${receiver}.createIndex(${jsString(name)}, ${jsString(column)});`;
			}
			return `${handle}
await ${receiver}.createIndex(${jsString(name)}, ${formatJson(definition ?? {})});`;
		}
	}

	return null;
}

function generatePython({
	workspace,
	command,
	targetKind,
	targetName,
}: CodeContext) {
	const endpoint = endpointForCode(workspace, "python");
	const preamble = `import os
from astrapy import DataAPIClient

${pythonDbSetup(endpoint, workspace.keyspace)}
`;

	const snippet = idiomaticPython(command, targetKind, targetName);
	if (snippet) {
		return `${preamble}\n${snippet}\n`;
	}

	const targetArg = targetName
		? `, ${targetKind}_name=${pyString(targetName)}`
		: "";
	return `import json
${preamble}
command = json.loads(r'''${formatJson(command)}''')
result = database.command(command${targetArg})
print(result)
`;
}

function idiomaticPython(
	command: Record<string, unknown>,
	targetKind: PlaygroundTargetKind,
	targetName: string | null,
): string | null {
	const extracted = extractCommand(command);
	if (!extracted) return null;
	const { op, body } = extracted;
	const name = typeof body.name === "string" ? body.name : "";

	switch (op) {
		case "findCollections": {
			return explainFlag(body)
				? `collections = database.list_collections()
print(collections)`
				: `names = database.list_collection_names()
print(names)`;
		}
		case "createCollection": {
			const options = body.options;
			if (options && typeof options === "object" && !Array.isArray(options)) {
				return `collection = database.create_collection(
    ${pyString(name)},
    definition=${pyDict(options)},
)
print(collection.name)`;
			}
			return `collection = database.create_collection(${pyString(name)})
print(collection.name)`;
		}
		case "deleteCollection": {
			return `database.drop_collection(${pyString(name)})
print(${pyString(`Dropped ${name}`)})`;
		}
		case "listTables": {
			return explainFlag(body)
				? `tables = database.list_tables()
print(tables)`
				: `names = database.list_table_names()
print(names)`;
		}
		case "createTable": {
			const definition = body.definition ?? {};
			return `table = database.create_table(
    ${pyString(name)},
    definition=${pyDict(definition)},
)
print(table.name)`;
		}
		case "dropTable": {
			return `database.drop_table(${pyString(name)})
print(${pyString(`Dropped ${name}`)})`;
		}
		case "dropIndex": {
			return `database.drop_table_index(${pyString(name)})
print(${pyString(`Dropped index ${name}`)})`;
		}
	}

	if (!targetName) return null;
	const handle =
		targetKind === "table"
			? `table = database.get_table(${pyString(targetName)})`
			: `collection = database.get_collection(${pyString(targetName)})`;
	const receiver = targetKind === "table" ? "table" : "collection";

	switch (op) {
		case "find": {
			const filter = body.filter ?? {};
			const options = body.options;
			const kwargs =
				options && typeof options === "object"
					? `, ${pyKwargsFromOptions(options as Record<string, unknown>)}`
					: "";
			return `${handle}
rows = list(${receiver}.find(${pyDict(filter)}${kwargs}))
print(rows)`;
		}
		case "findOne": {
			const filter = body.filter ?? {};
			return `${handle}
row = ${receiver}.find_one(${pyDict(filter)})
print(row)`;
		}
		case "distinct": {
			const key = typeof body.key === "string" ? body.key : "";
			const filter = body.filter ?? {};
			return `${handle}
values = ${receiver}.distinct(${pyString(key)}, filter=${pyDict(filter)})
print(values)`;
		}
		case "countDocuments": {
			const filter = body.filter ?? {};
			const upper =
				typeof body.upperBound === "number" ? body.upperBound : 1000;
			return `${handle}
total = ${receiver}.count_documents(${pyDict(filter)}, upper_bound=${upper})
print(total)`;
		}
		case "insertOne": {
			const document = body.document ?? {};
			return `${handle}
result = ${receiver}.insert_one(${pyDict(document)})
print(result)`;
		}
		case "insertMany": {
			const documents = body.documents ?? [];
			return `${handle}
result = ${receiver}.insert_many(${pyValue(documents)})
print(result)`;
		}
		case "updateOne": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
result = ${receiver}.update_one(${pyDict(filter)}, ${pyDict(update)})
print(result)`;
		}
		case "updateMany": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
result = ${receiver}.update_many(${pyDict(filter)}, ${pyDict(update)})
print(result)`;
		}
		case "deleteOne": {
			const filter = body.filter ?? {};
			return `${handle}
result = ${receiver}.delete_one(${pyDict(filter)})
print(result)`;
		}
		case "deleteMany": {
			const filter = body.filter ?? {};
			return `${handle}
result = ${receiver}.delete_many(${pyDict(filter)})
print(result)`;
		}
		case "listIndexes": {
			return explainFlag(body)
				? `${handle}
indexes = ${receiver}.list_indexes()
print(indexes)`
				: `${handle}
names = ${receiver}.list_index_names()
print(names)`;
		}
		case "createIndex": {
			const definition = body.definition;
			if (
				definition &&
				typeof definition === "object" &&
				!Array.isArray(definition) &&
				typeof (definition as Record<string, unknown>).column === "string"
			) {
				const column = (definition as Record<string, unknown>).column as string;
				return `${handle}
${receiver}.create_index(${pyString(name)}, column=${pyString(column)})`;
			}
			return `${handle}
${receiver}.create_index(${pyString(name)}, definition=${pyDict(definition ?? {})})`;
		}
	}

	return null;
}

function generateJava({
	workspace,
	command,
	targetKind,
	targetName,
}: CodeContext) {
	const endpoint = endpointForCode(workspace, "java");

	const snippet = idiomaticJava(command, targetKind, targetName);
	if (snippet) {
		const imports = javaImportsFor(snippet);
		return `${imports}

${javaDbSetup(endpoint, workspace.keyspace)}

${snippet}
`;
	}

	const keyspace = javaString(workspace.keyspace ?? "");
	const target = javaString(targetName ?? "");
	return `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

String endpoint = ${endpoint};
String keyspace = ${keyspace};
String target = ${target};
String body = """
${formatJson(command)}
""";

String path = "/api/json/v1"
    + (keyspace.isEmpty() ? "" : "/" + keyspace)
    + (target.isEmpty() ? "" : "/" + target);

HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint + path))
    .header("Content-Type", "application/json")
    .header("Token", System.getenv("ASTRA_DB_APPLICATION_TOKEN"))
    .POST(HttpRequest.BodyPublishers.ofString(body))
    .build();

String result = HttpClient.newHttpClient()
    .send(request, HttpResponse.BodyHandlers.ofString())
    .body();
System.out.println(result);
`;
}

function idiomaticJava(
	command: Record<string, unknown>,
	targetKind: PlaygroundTargetKind,
	targetName: string | null,
): string | null {
	const extracted = extractCommand(command);
	if (!extracted) return null;
	const { op, body } = extracted;
	const name = typeof body.name === "string" ? body.name : "";

	switch (op) {
		case "findCollections": {
			return explainFlag(body)
				? `db.listCollections().forEach(System.out::println);`
				: `db.listCollectionNames().forEach(System.out::println);`;
		}
		case "createCollection": {
			return `Collection<Document> collection = db.createCollection(${javaString(name)});
System.out.println(collection.getName());`;
		}
		case "deleteCollection": {
			return `db.dropCollection(${javaString(name)});
System.out.println("Dropped ${name}");`;
		}
		case "listTables": {
			return explainFlag(body)
				? `db.listTables().forEach(System.out::println);`
				: `db.listTableNames().forEach(System.out::println);`;
		}
		case "dropTable": {
			return `db.dropTable(${javaString(name)});
System.out.println("Dropped ${name}");`;
		}
		case "dropIndex": {
			return `db.dropTableIndex(${javaString(name)});
System.out.println("Dropped index ${name}");`;
		}
		case "createTable": {
			return `// Build the table definition with the fluent TableDefinition API.
// db.createTable(${javaString(name)}, new TableDefinition()
//     .addColumnText("id")
//     .addPartitionBy("id"));`;
		}
	}

	if (!targetName) return null;
	const handle =
		targetKind === "table"
			? `Table<Row> table = db.getTable(${javaString(targetName)});`
			: `Collection<Document> collection = db.getCollection(${javaString(targetName)});`;
	const receiver = targetKind === "table" ? "table" : "collection";
	const docType = targetKind === "table" ? "Row" : "Document";

	switch (op) {
		case "find": {
			const filter = body.filter ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
${receiver}.find(filter).forEach(System.out::println);`;
		}
		case "findOne": {
			const filter = body.filter ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
${receiver}.findOne(filter).ifPresent(System.out::println);`;
		}
		case "distinct": {
			const key = typeof body.key === "string" ? body.key : "";
			const filter = body.filter ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
${receiver}.distinct(${javaString(key)}, filter, Object.class)
    .forEach(System.out::println);`;
		}
		case "countDocuments": {
			const filter = body.filter ?? {};
			const upper =
				typeof body.upperBound === "number" ? body.upperBound : 1000;
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
long total = ${receiver}.countDocuments(filter, ${upper});
System.out.println(total);`;
		}
		case "insertOne": {
			const document = body.document ?? {};
			return `${handle}
${docType} document = ${docType}.parse(${javaTextBlock(document)});
System.out.println(${receiver}.insertOne(document));`;
		}
		case "insertMany": {
			const documents = body.documents ?? [];
			return `${handle}
List<${docType}> documents = List.of(${javaDocList(documents, docType)});
System.out.println(${receiver}.insertMany(documents));`;
		}
		case "updateOne": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
${docType} update = ${docType}.parse(${javaTextBlock(update)});
System.out.println(${receiver}.updateOne(filter, update));`;
		}
		case "updateMany": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
${docType} update = ${docType}.parse(${javaTextBlock(update)});
System.out.println(${receiver}.updateMany(filter, update));`;
		}
		case "deleteOne": {
			const filter = body.filter ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
System.out.println(${receiver}.deleteOne(filter));`;
		}
		case "deleteMany": {
			const filter = body.filter ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
System.out.println(${receiver}.deleteMany(filter));`;
		}
		case "listIndexes": {
			return explainFlag(body)
				? `${handle}
${receiver}.listIndexes().forEach(System.out::println);`
				: `${handle}
${receiver}.listIndexNames().forEach(System.out::println);`;
		}
		case "createIndex": {
			const definition = body.definition;
			if (
				definition &&
				typeof definition === "object" &&
				!Array.isArray(definition) &&
				typeof (definition as Record<string, unknown>).column === "string"
			) {
				const column = (definition as Record<string, unknown>).column as string;
				return `${handle}
${receiver}.createIndex(${javaString(name)}, ${javaString(column)});`;
			}
			return null;
		}
	}

	return null;
}

function pyValue(value: unknown): string {
	if (value === null) return "None";
	if (typeof value === "boolean") return value ? "True" : "False";
	if (typeof value === "number")
		return Number.isFinite(value) ? `${value}` : "None";
	if (typeof value === "string") return pyString(value);
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const items = value.map((item) => pyValue(item));
		return `[\n    ${items.join(",\n    ").replace(/\n/g, "\n    ")},\n]`;
	}
	if (typeof value === "object") {
		return pyDict(value as Record<string, unknown>);
	}
	return "None";
}

function pyDict(value: unknown): string {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return "{}";
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length === 0) return "{}";
	const lines = entries.map(
		([k, v]) =>
			`    ${pyString(k)}: ${indentLines(pyValue(v), "    ").trimStart()}`,
	);
	return `{\n${lines.join(",\n")},\n}`;
}

function pyKwargsFromOptions(options: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(options)) {
		const pyKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
		parts.push(`${pyKey}=${pyValue(value)}`);
	}
	return parts.join(", ");
}

const JAVA_OPTIONAL_IMPORTS: ReadonlyArray<{ token: RegExp; path: string }> = [
	{
		token: /\bCollection</,
		path: "com.datastax.astra.client.collections.Collection",
	},
	{
		token: /\bDocument\b/,
		path: "com.datastax.astra.client.collections.definition.documents.Document",
	},
	{ token: /\bTable</, path: "com.datastax.astra.client.tables.Table" },
	{
		token: /\bRow\b/,
		path: "com.datastax.astra.client.tables.definition.rows.Row",
	},
	{ token: /\bList[<.]/, path: "java.util.List" },
];

function javaImportsFor(snippet: string): string {
	const lines = [
		"import com.datastax.astra.client.DataAPIClient;",
		"import com.datastax.astra.client.core.options.DataAPIClientOptions;",
		"import com.datastax.astra.client.databases.Database;",
		"import com.datastax.astra.client.databases.DatabaseOptions;",
	];
	for (const { token, path } of JAVA_OPTIONAL_IMPORTS) {
		if (token.test(snippet)) {
			lines.push(`import ${path};`);
		}
	}
	return lines.join("\n");
}

function javaTextBlock(value: unknown): string {
	return `"""
${formatJson(value)}
"""`;
}

function javaDocList(value: unknown, docType: string): string {
	if (!Array.isArray(value) || value.length === 0) return "";
	return value
		.map((item) => `${docType}.parse(${javaTextBlock(item)})`)
		.join(", ");
}

function generateCurl({ workspace, command, targetName }: CodeContext) {
	const endpoint = endpointForCode(workspace, "curl");
	const keyspaceSegment = workspace.keyspace ? `/${workspace.keyspace}` : "";
	const targetSegment = targetName ? `/${targetName}` : "";
	return `curl -sS -X POST "${endpoint}/api/json/v1${keyspaceSegment}${targetSegment}" \\
  -H "Content-Type: application/json" \\
  -H "Token: $ASTRA_DB_APPLICATION_TOKEN" \\
  --data '${escapeCurlBody(formatJson(command))}'
`;
}

function endpointForCode(workspace: Workspace, language: CodeLanguage): string {
	if (workspace.url && isLiteralUrl(workspace.url)) {
		if (language === "curl") return trimTrailingSlash(workspace.url);
		return language === "python"
			? pyString(workspace.url)
			: jsString(workspace.url);
	}
	if (language === "python") return 'os.environ["ASTRA_DB_API_ENDPOINT"]';
	if (language === "java") return 'System.getenv("ASTRA_DB_API_ENDPOINT")';
	if (language === "curl") return "$ASTRA_DB_API_ENDPOINT";
	return "process.env.ASTRA_DB_API_ENDPOINT!";
}

function isLiteralUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}
