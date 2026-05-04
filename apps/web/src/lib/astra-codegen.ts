/**
 * Generates client-code snippets for an {@link AstraQuerySnapshot} —
 * the per-tool-call envelope captured during chat retrieval.
 * Powers the "view client code" affordance on the assistant message
 * bubble (`AstraQueryCodeButton` → `AstraQueryCodeDialog`).
 *
 * Four output languages:
 *   - **TypeScript** with `@datastax/astra-db-ts`
 *   - **Python**     with `astrapy`
 *   - **Java**       with `com.datastax.astra:astra-db-java`
 *   - **cURL**       against the Data API
 *
 * Two snapshot shapes:
 *   - `vector_search` — `find` with `$vectorize` sort, top-K limit
 *   - `list_chunks`   — `find` filtered by `documentId`, sorted by
 *     `chunkIndex`, with limit + skip
 *
 * The generators use placeholder `process.env.…` / `getenv` patterns
 * for the token and endpoint — those values are deliberately not
 * captured in the persisted envelope. The user copy-pastes and fills
 * them in. Collection name, keyspace, and query parameters come from
 * the snapshot.
 *
 * Strings are escaped for the target language so a query containing
 * quotes / newlines / backslashes round-trips without breaking the
 * snippet.
 */

import type {
	AstraListChunksSnapshot,
	AstraQuerySnapshot,
	AstraVectorSearchSnapshot,
} from "./schemas";

export type CodeLanguage = "typescript" | "python" | "java" | "curl";

export const CODE_LANGUAGES: readonly {
	readonly id: CodeLanguage;
	readonly label: string;
}[] = [
	{ id: "typescript", label: "TypeScript" },
	{ id: "python", label: "Python" },
	{ id: "java", label: "Java" },
	{ id: "curl", label: "cURL" },
];

export function generateCode(
	language: CodeLanguage,
	snapshot: AstraQuerySnapshot,
): string {
	if (snapshot.kind === "vector_search") {
		switch (language) {
			case "typescript":
				return generateVectorSearchTypeScript(snapshot);
			case "python":
				return generateVectorSearchPython(snapshot);
			case "java":
				return generateVectorSearchJava(snapshot);
			case "curl":
				return generateVectorSearchCurl(snapshot);
		}
	}
	switch (language) {
		case "typescript":
			return generateListChunksTypeScript(snapshot);
		case "python":
			return generateListChunksPython(snapshot);
		case "java":
			return generateListChunksJava(snapshot);
		case "curl":
			return generateListChunksCurl(snapshot);
	}
}

/* ---------------- vector_search generators ---------------- */

function generateVectorSearchTypeScript(s: AstraVectorSearchSnapshot): string {
	const text = jsString(s.query.text);
	const collection = jsString(s.collection);
	const keyspaceArg = s.keyspace
		? `, { keyspace: ${jsString(s.keyspace)} }`
		: "";
	return `import { DataAPIClient } from "@datastax/astra-db-ts";

const client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN!);
const db = client.db(process.env.ASTRA_DB_API_ENDPOINT!${keyspaceArg});
const collection = db.collection(${collection});

// Server-side embedding via $vectorize — the same call AI Workbench made.
const cursor = collection.find(
  {},
  {
    sort: { $vectorize: ${text} },
    limit: ${s.query.topK},
    includeSimilarity: true,
  },
);
const hits = await cursor.toArray();
console.log(hits);
`;
}

function generateVectorSearchPython(s: AstraVectorSearchSnapshot): string {
	const text = pyString(s.query.text);
	const collection = pyString(s.collection);
	const keyspaceArg = s.keyspace ? `, keyspace=${pyString(s.keyspace)}` : "";
	return `import os
from astrapy import DataAPIClient

client = DataAPIClient(os.environ["ASTRA_DB_APPLICATION_TOKEN"])
database = client.get_database(
    os.environ["ASTRA_DB_API_ENDPOINT"]${keyspaceArg},
)
collection = database.get_collection(${collection})

# Server-side embedding via $vectorize — the same call AI Workbench made.
hits = list(
    collection.find(
        {},
        sort={"$vectorize": ${text}},
        limit=${s.query.topK},
        include_similarity=True,
    )
)
print(hits)
`;
}

function generateVectorSearchJava(s: AstraVectorSearchSnapshot): string {
	const text = javaString(s.query.text);
	const collection = javaString(s.collection);
	const keyspaceCall = s.keyspace ? `, ${javaString(s.keyspace)}` : "";
	return `import com.datastax.astra.client.DataAPIClient;
import com.datastax.astra.client.databases.Database;
import com.datastax.astra.client.collections.Collection;
import com.datastax.astra.client.collections.commands.options.CollectionFindOptions;
import com.datastax.astra.client.core.query.Sort;
import com.datastax.astra.client.core.vector.DataAPIVector;
import com.datastax.astra.client.core.query.Filter;
import java.util.List;
import java.util.stream.StreamSupport;

DataAPIClient client = new DataAPIClient(System.getenv("ASTRA_DB_APPLICATION_TOKEN"));
Database db = client.getDatabase(System.getenv("ASTRA_DB_API_ENDPOINT")${keyspaceCall});
Collection<com.fasterxml.jackson.databind.JsonNode> collection =
    db.getCollection(${collection}, com.fasterxml.jackson.databind.JsonNode.class);

// Server-side embedding via $vectorize — the same call AI Workbench made.
CollectionFindOptions options = new CollectionFindOptions()
    .sort(Sort.vectorize(${text}))
    .limit(${s.query.topK})
    .includeSimilarity(true);
var hits = StreamSupport
    .stream(collection.find(new Filter(), options).spliterator(), false)
    .toList();
System.out.println(hits);
`;
}

function generateVectorSearchCurl(s: AstraVectorSearchSnapshot): string {
	const body = JSON.stringify(
		{
			find: {
				sort: { $vectorize: s.query.text },
				options: {
					limit: s.query.topK,
					includeSimilarity: true,
				},
			},
		},
		null,
		2,
	);
	const keyspaceSegment = s.keyspace ? `/${s.keyspace}` : "";
	return `# Replace ASTRA_DB_API_ENDPOINT + ASTRA_DB_APPLICATION_TOKEN with the
# values for your database. Server-side embedding ($vectorize) — the
# same call AI Workbench made.
curl -sS -X POST "$ASTRA_DB_API_ENDPOINT/api/json/v1${keyspaceSegment}/${s.collection}" \\
  -H "Content-Type: application/json" \\
  -H "Token: $ASTRA_DB_APPLICATION_TOKEN" \\
  --data '${body.replace(/'/g, "'\\''")}'
`;
}

/* ---------------- list_chunks generators ----------------
 *
 * `list_chunks` is a positional read: every chunk of a specific
 * document, in order, paginated. The natural Astra Data API shape is
 * `find({documentId}).sort({chunkIndex: 1}).limit(N)` — with `.skip`
 * (cURL: `options.skip`) when offset > 0. The runtime's internal
 * implementation pulls `offset+limit` and trims client-side; the
 * generated snippets use the idiomatic sort+skip form so the
 * copy-paste user-experience matches what someone would write by
 * hand. */

function listChunksKeyspaceTsArg(keyspace: string | null): string {
	return keyspace ? `, { keyspace: ${jsString(keyspace)} }` : "";
}

function generateListChunksTypeScript(s: AstraListChunksSnapshot): string {
	const docId = jsString(s.query.documentId);
	const collection = jsString(s.collection);
	const keyspaceArg = listChunksKeyspaceTsArg(s.keyspace);
	const skipLine = s.query.offset > 0 ? `\n    skip: ${s.query.offset},` : "";
	return `import { DataAPIClient } from "@datastax/astra-db-ts";

const client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN!);
const db = client.db(process.env.ASTRA_DB_API_ENDPOINT!${keyspaceArg});
const collection = db.collection(${collection});

// Positional read — same call AI Workbench made for list_chunks.
const cursor = collection.find(
  { documentId: ${docId} },
  {
    sort: { chunkIndex: 1 },
    limit: ${s.query.limit},${skipLine}
  },
);
const chunks = await cursor.toArray();
console.log(chunks);
`;
}

function generateListChunksPython(s: AstraListChunksSnapshot): string {
	const docId = pyString(s.query.documentId);
	const collection = pyString(s.collection);
	const keyspaceArg = s.keyspace ? `, keyspace=${pyString(s.keyspace)}` : "";
	const skipLine =
		s.query.offset > 0 ? `\n        skip=${s.query.offset},` : "";
	return `import os
from astrapy import DataAPIClient

client = DataAPIClient(os.environ["ASTRA_DB_APPLICATION_TOKEN"])
database = client.get_database(
    os.environ["ASTRA_DB_API_ENDPOINT"]${keyspaceArg},
)
collection = database.get_collection(${collection})

# Positional read — same call AI Workbench made for list_chunks.
chunks = list(
    collection.find(
        {"documentId": ${docId}},
        sort={"chunkIndex": 1},
        limit=${s.query.limit},${skipLine}
    )
)
print(chunks)
`;
}

function generateListChunksJava(s: AstraListChunksSnapshot): string {
	const docId = javaString(s.query.documentId);
	const collection = javaString(s.collection);
	const keyspaceCall = s.keyspace ? `, ${javaString(s.keyspace)}` : "";
	const skipLine = s.query.offset > 0 ? `\n    .skip(${s.query.offset})` : "";
	return `import com.datastax.astra.client.DataAPIClient;
import com.datastax.astra.client.databases.Database;
import com.datastax.astra.client.collections.Collection;
import com.datastax.astra.client.collections.commands.options.CollectionFindOptions;
import com.datastax.astra.client.core.query.Filter;
import com.datastax.astra.client.core.query.Filters;
import com.datastax.astra.client.core.query.Sort;
import java.util.List;
import java.util.stream.StreamSupport;

DataAPIClient client = new DataAPIClient(System.getenv("ASTRA_DB_APPLICATION_TOKEN"));
Database db = client.getDatabase(System.getenv("ASTRA_DB_API_ENDPOINT")${keyspaceCall});
Collection<com.fasterxml.jackson.databind.JsonNode> collection =
    db.getCollection(${collection}, com.fasterxml.jackson.databind.JsonNode.class);

// Positional read — same call AI Workbench made for list_chunks.
CollectionFindOptions options = new CollectionFindOptions()
    .sort(Sort.ascending("chunkIndex"))
    .limit(${s.query.limit})${skipLine};
var chunks = StreamSupport
    .stream(collection.find(Filters.eq("documentId", ${docId}), options).spliterator(), false)
    .toList();
System.out.println(chunks);
`;
}

function generateListChunksCurl(s: AstraListChunksSnapshot): string {
	const findOptions: Record<string, number> = { limit: s.query.limit };
	if (s.query.offset > 0) findOptions.skip = s.query.offset;
	const body = JSON.stringify(
		{
			find: {
				filter: { documentId: s.query.documentId },
				sort: { chunkIndex: 1 },
				options: findOptions,
			},
		},
		null,
		2,
	);
	const keyspaceSegment = s.keyspace ? `/${s.keyspace}` : "";
	return `# Replace ASTRA_DB_API_ENDPOINT + ASTRA_DB_APPLICATION_TOKEN with the
# values for your database. Positional read — same call AI Workbench
# made for list_chunks.
curl -sS -X POST "$ASTRA_DB_API_ENDPOINT/api/json/v1${keyspaceSegment}/${s.collection}" \\
  -H "Content-Type: application/json" \\
  -H "Token: $ASTRA_DB_APPLICATION_TOKEN" \\
  --data '${body.replace(/'/g, "'\\''")}'
`;
}

/* ---------------- string escapers ---------------- */

function jsString(s: string): string {
	return JSON.stringify(s);
}

function pyString(s: string): string {
	// Python and JSON string syntax overlap enough that we can reuse
	// JSON.stringify for the common case (no triple-quoted multiline).
	return JSON.stringify(s);
}

function javaString(s: string): string {
	return JSON.stringify(s);
}
