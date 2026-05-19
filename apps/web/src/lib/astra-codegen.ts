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
	AstraCreateCollectionSnapshot,
	AstraDeleteByDocumentSnapshot,
	AstraDeleteChunkSnapshot,
	AstraInsertChunksSnapshot,
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

/**
 * Six discriminated kinds × four output languages = 24 generator
 * functions. The switch is exhaustive — adding a new kind without a
 * matching generator block fails the TypeScript build.
 */
export function generateCode(
	language: CodeLanguage,
	snapshot: AstraQuerySnapshot,
): string {
	switch (snapshot.kind) {
		case "vector_search":
			return generateVectorSearch(language, snapshot);
		case "list_chunks":
			return generateListChunks(language, snapshot);
		case "create_collection":
			return generateCreateCollection(language, snapshot);
		case "insert_chunks":
			return generateInsertChunks(language, snapshot);
		case "delete_by_document":
			return generateDeleteByDocument(language, snapshot);
		case "delete_chunk":
			return generateDeleteChunk(language, snapshot);
	}
}

function generateVectorSearch(
	language: CodeLanguage,
	s: AstraVectorSearchSnapshot,
): string {
	switch (language) {
		case "typescript":
			return generateVectorSearchTypeScript(s);
		case "python":
			return generateVectorSearchPython(s);
		case "java":
			return generateVectorSearchJava(s);
		case "curl":
			return generateVectorSearchCurl(s);
	}
}

function generateListChunks(
	language: CodeLanguage,
	s: AstraListChunksSnapshot,
): string {
	switch (language) {
		case "typescript":
			return generateListChunksTypeScript(s);
		case "python":
			return generateListChunksPython(s);
		case "java":
			return generateListChunksJava(s);
		case "curl":
			return generateListChunksCurl(s);
	}
}

function generateCreateCollection(
	language: CodeLanguage,
	s: AstraCreateCollectionSnapshot,
): string {
	switch (language) {
		case "typescript":
			return generateCreateCollectionTypeScript(s);
		case "python":
			return generateCreateCollectionPython(s);
		case "java":
			return generateCreateCollectionJava(s);
		case "curl":
			return generateCreateCollectionCurl(s);
	}
}

function generateInsertChunks(
	language: CodeLanguage,
	s: AstraInsertChunksSnapshot,
): string {
	switch (language) {
		case "typescript":
			return generateInsertChunksTypeScript(s);
		case "python":
			return generateInsertChunksPython(s);
		case "java":
			return generateInsertChunksJava(s);
		case "curl":
			return generateInsertChunksCurl(s);
	}
}

function generateDeleteByDocument(
	language: CodeLanguage,
	s: AstraDeleteByDocumentSnapshot,
): string {
	switch (language) {
		case "typescript":
			return generateDeleteByDocumentTypeScript(s);
		case "python":
			return generateDeleteByDocumentPython(s);
		case "java":
			return generateDeleteByDocumentJava(s);
		case "curl":
			return generateDeleteByDocumentCurl(s);
	}
}

function generateDeleteChunk(
	language: CodeLanguage,
	s: AstraDeleteChunkSnapshot,
): string {
	switch (language) {
		case "typescript":
			return generateDeleteChunkTypeScript(s);
		case "python":
			return generateDeleteChunkPython(s);
		case "java":
			return generateDeleteChunkJava(s);
		case "curl":
			return generateDeleteChunkCurl(s);
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

/* ---------------- create_collection generators ----------------
 *
 * The runtime calls `db.createCollection(name, opts)` whenever a KB
 * is created in owned mode. The snippet rebuilds the exact options
 * payload — vector dimension, similarity metric, optional
 * `$vectorize` server-side embedding service, optional `lexical`
 * analyzer, optional `rerank` service — so the user can run the
 * same create against their database.
 */

function tsObjectLiteral(lines: readonly string[], indent: number): string {
	if (lines.length === 0) return "{}";
	const pad = " ".repeat(indent);
	return `{\n${lines.map((l) => `${pad}${l}`).join("\n")}\n${" ".repeat(indent - 2)}}`;
}

function generateCreateCollectionTypeScript(
	s: AstraCreateCollectionSnapshot,
): string {
	const collection = jsString(s.collection);
	const keyspaceArg = s.keyspace
		? `, { keyspace: ${jsString(s.keyspace)} }`
		: "";
	const vectorLines = [
		`dimension: ${s.options.vectorDimension},`,
		`metric: ${jsString(s.options.vectorMetric)},`,
	];
	if (s.options.vectorize) {
		vectorLines.push(
			`service: { provider: ${jsString(s.options.vectorize.provider)}, modelName: ${jsString(s.options.vectorize.modelName)} },`,
		);
	}
	const optsLines: string[] = [`vector: ${tsObjectLiteral(vectorLines, 6)},`];
	if (s.options.lexical) {
		optsLines.push(
			`lexical: { enabled: true, analyzer: ${jsString(s.options.lexical.analyzer)} },`,
		);
	}
	if (s.options.rerank) {
		optsLines.push(
			`rerank: { enabled: true, service: { provider: ${jsString(s.options.rerank.provider)}, modelName: ${jsString(s.options.rerank.modelName)} } },`,
		);
	}
	return `import { DataAPIClient } from "@datastax/astra-db-ts";

const client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN!);
const db = client.db(process.env.ASTRA_DB_API_ENDPOINT!${keyspaceArg});

// Provision the underlying collection — the same call AI Workbench
// runs when you create a knowledge base in owned mode.
await db.createCollection(${collection}, ${tsObjectLiteral(optsLines, 4)});
`;
}

function generateCreateCollectionPython(
	s: AstraCreateCollectionSnapshot,
): string {
	const collection = pyString(s.collection);
	const keyspaceArg = s.keyspace ? `, keyspace=${pyString(s.keyspace)}` : "";
	const vector: Record<string, unknown> = {
		dimension: s.options.vectorDimension,
		metric: s.options.vectorMetric,
	};
	if (s.options.vectorize) {
		vector.service = {
			provider: s.options.vectorize.provider,
			model_name: s.options.vectorize.modelName,
		};
	}
	const opts: Record<string, unknown> = { vector };
	if (s.options.lexical) {
		opts.lexical = {
			enabled: true,
			analyzer: s.options.lexical.analyzer,
		};
	}
	if (s.options.rerank) {
		opts.rerank = {
			enabled: true,
			service: {
				provider: s.options.rerank.provider,
				model_name: s.options.rerank.modelName,
			},
		};
	}
	const optsPython = pyDict(opts, 0);
	return `import os
from astrapy import DataAPIClient

client = DataAPIClient(os.environ["ASTRA_DB_APPLICATION_TOKEN"])
database = client.get_database(
    os.environ["ASTRA_DB_API_ENDPOINT"]${keyspaceArg},
)

# Provision the underlying collection — the same call AI Workbench
# runs when you create a knowledge base in owned mode.
database.create_collection(
    ${collection},
    definition=${optsPython},
)
`;
}

function generateCreateCollectionJava(
	s: AstraCreateCollectionSnapshot,
): string {
	const collection = javaString(s.collection);
	const keyspaceCall = s.keyspace ? `, ${javaString(s.keyspace)}` : "";
	const lines: string[] = [
		`CollectionDefinition def = new CollectionDefinition()`,
		`    .vector(${s.options.vectorDimension}, SimilarityMetric.${s.options.vectorMetric.toUpperCase()})`,
	];
	if (s.options.vectorize) {
		lines.push(
			`    .vectorize(${javaString(s.options.vectorize.provider)}, ${javaString(s.options.vectorize.modelName)})`,
		);
	}
	if (s.options.lexical) {
		lines.push(`    .lexical(${javaString(s.options.lexical.analyzer)})`);
	}
	if (s.options.rerank) {
		lines.push(
			`    .rerank(${javaString(s.options.rerank.provider)}, ${javaString(s.options.rerank.modelName)})`,
		);
	}
	const lastIdx = lines.length - 1;
	const body = lines.map((l, i) => (i === lastIdx ? `${l};` : l)).join("\n");
	return `import com.datastax.astra.client.DataAPIClient;
import com.datastax.astra.client.databases.Database;
import com.datastax.astra.client.collections.definition.CollectionDefinition;
import com.datastax.astra.client.core.vector.SimilarityMetric;

DataAPIClient client = new DataAPIClient(System.getenv("ASTRA_DB_APPLICATION_TOKEN"));
Database db = client.getDatabase(System.getenv("ASTRA_DB_API_ENDPOINT")${keyspaceCall});

// Provision the underlying collection — the same call AI Workbench
// runs when you create a knowledge base in owned mode.
${body}
db.createCollection(${collection}, def);
`;
}

function generateCreateCollectionCurl(
	s: AstraCreateCollectionSnapshot,
): string {
	const vector: Record<string, unknown> = {
		dimension: s.options.vectorDimension,
		metric: s.options.vectorMetric,
	};
	if (s.options.vectorize) {
		vector.service = {
			provider: s.options.vectorize.provider,
			modelName: s.options.vectorize.modelName,
		};
	}
	const options: Record<string, unknown> = { vector };
	if (s.options.lexical) {
		options.lexical = {
			enabled: true,
			analyzer: s.options.lexical.analyzer,
		};
	}
	if (s.options.rerank) {
		options.rerank = {
			enabled: true,
			service: {
				provider: s.options.rerank.provider,
				modelName: s.options.rerank.modelName,
			},
		};
	}
	const body = JSON.stringify(
		{
			createCollection: {
				name: s.collection,
				options,
			},
		},
		null,
		2,
	);
	const keyspaceSegment = s.keyspace ? `/${s.keyspace}` : "";
	return `# Replace ASTRA_DB_API_ENDPOINT + ASTRA_DB_APPLICATION_TOKEN with the
# values for your database. The same call AI Workbench runs to
# create the underlying collection for a knowledge base.
curl -sS -X POST "$ASTRA_DB_API_ENDPOINT/api/json/v1${keyspaceSegment}" \\
  -H "Content-Type: application/json" \\
  -H "Token: $ASTRA_DB_APPLICATION_TOKEN" \\
  --data '${escapeCurlBody(body)}'
`;
}

/* ---------------- insert_chunks generators ----------------
 *
 * Ingest writes one `insertMany` call per chunk batch. Each chunk
 * doc carries `$vectorize` (the chunk text, embedded server-side),
 * `knowledgeBaseId`, `documentId`, and `chunkIndex`. The snippet
 * shows the shape of one batch with placeholder chunk text — the
 * real text comes from the user's source document.
 *
 * The footer note in the dialog (rendered by the chip component, not
 * by this generator) reminds users the call repeats for each batch
 * of `batchSize` chunks.
 */

function generateInsertChunksTypeScript(s: AstraInsertChunksSnapshot): string {
	const collection = jsString(s.collection);
	const keyspaceArg = s.keyspace
		? `, { keyspace: ${jsString(s.keyspace)} }`
		: "";
	const docId = jsString(s.batch.documentId);
	return `import { DataAPIClient } from "@datastax/astra-db-ts";

const client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN!);
const db = client.db(process.env.ASTRA_DB_API_ENDPOINT!${keyspaceArg});
const collection = db.collection(${collection});

// One chunk batch of size ${s.batch.batchSize} — the same call AI
// Workbench's ingest pipeline runs (repeated per batch until every
// chunk of the document is written). Replace the placeholder text
// with your chunked source content. $vectorize lets Astra embed
// server-side; the values become $vector under the hood.
const docs = [
  {
    _id: "chunk-0",
    $vectorize: "first chunk text…",
    knowledgeBaseId: ${jsString(s.knowledgeBaseId)},
    documentId: ${docId},
    chunkIndex: 0,
  },
  // …${s.batch.batchSize - 1} more rows of the same shape
];
await collection.insertMany(docs);
`;
}

function generateInsertChunksPython(s: AstraInsertChunksSnapshot): string {
	const collection = pyString(s.collection);
	const keyspaceArg = s.keyspace ? `, keyspace=${pyString(s.keyspace)}` : "";
	const docId = pyString(s.batch.documentId);
	return `import os
from astrapy import DataAPIClient

client = DataAPIClient(os.environ["ASTRA_DB_APPLICATION_TOKEN"])
database = client.get_database(
    os.environ["ASTRA_DB_API_ENDPOINT"]${keyspaceArg},
)
collection = database.get_collection(${collection})

# One chunk batch of size ${s.batch.batchSize} — the same call AI
# Workbench's ingest pipeline runs (repeated per batch until every
# chunk of the document is written). Replace the placeholder text
# with your chunked source content. $vectorize lets Astra embed
# server-side; the values become $vector under the hood.
docs = [
    {
        "_id": "chunk-0",
        "$vectorize": "first chunk text…",
        "knowledgeBaseId": ${pyString(s.knowledgeBaseId)},
        "documentId": ${docId},
        "chunkIndex": 0,
    },
    # …${s.batch.batchSize - 1} more rows of the same shape
]
collection.insert_many(docs)
`;
}

function generateInsertChunksJava(s: AstraInsertChunksSnapshot): string {
	const collection = javaString(s.collection);
	const keyspaceCall = s.keyspace ? `, ${javaString(s.keyspace)}` : "";
	const docId = javaString(s.batch.documentId);
	return `import com.datastax.astra.client.DataAPIClient;
import com.datastax.astra.client.databases.Database;
import com.datastax.astra.client.collections.Collection;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;

DataAPIClient client = new DataAPIClient(System.getenv("ASTRA_DB_APPLICATION_TOKEN"));
Database db = client.getDatabase(System.getenv("ASTRA_DB_API_ENDPOINT")${keyspaceCall});
Collection<JsonNode> collection = db.getCollection(${collection}, JsonNode.class);

// One chunk batch of size ${s.batch.batchSize} — the same call AI
// Workbench's ingest pipeline runs (repeated per batch until every
// chunk of the document is written). Replace placeholder text with
// your chunked source content.
ObjectMapper mapper = new ObjectMapper();
List<JsonNode> docs = new ArrayList<>();
ObjectNode chunk = mapper.createObjectNode();
chunk.put("_id", "chunk-0");
chunk.put("$vectorize", "first chunk text…");
chunk.put("knowledgeBaseId", ${javaString(s.knowledgeBaseId)});
chunk.put("documentId", ${docId});
chunk.put("chunkIndex", 0);
docs.add(chunk);
// …${s.batch.batchSize - 1} more rows of the same shape

collection.insertMany(docs);
`;
}

function generateInsertChunksCurl(s: AstraInsertChunksSnapshot): string {
	const body = JSON.stringify(
		{
			insertMany: {
				documents: [
					{
						_id: "chunk-0",
						$vectorize: "first chunk text…",
						knowledgeBaseId: s.knowledgeBaseId,
						documentId: s.batch.documentId,
						chunkIndex: 0,
					},
				],
			},
		},
		null,
		2,
	);
	const keyspaceSegment = s.keyspace ? `/${s.keyspace}` : "";
	return `# Replace ASTRA_DB_API_ENDPOINT + ASTRA_DB_APPLICATION_TOKEN with the
# values for your database. One chunk batch (size ${s.batch.batchSize})
# — the same call AI Workbench's ingest pipeline runs, repeated per
# batch until the document is fully written. Replace the placeholder
# chunk text with your source content.
curl -sS -X POST "$ASTRA_DB_API_ENDPOINT/api/json/v1${keyspaceSegment}/${s.collection}" \\
  -H "Content-Type: application/json" \\
  -H "Token: $ASTRA_DB_APPLICATION_TOKEN" \\
  --data '${escapeCurlBody(body)}'
`;
}

/* ---------------- delete_by_document generators ----------------
 *
 * Document-cascade delete: drop every chunk with the given
 * `documentId`. Snippet shows `coll.deleteMany({ documentId })`.
 */

function generateDeleteByDocumentTypeScript(
	s: AstraDeleteByDocumentSnapshot,
): string {
	const collection = jsString(s.collection);
	const keyspaceArg = s.keyspace
		? `, { keyspace: ${jsString(s.keyspace)} }`
		: "";
	const docId = jsString(s.filter.documentId);
	return `import { DataAPIClient } from "@datastax/astra-db-ts";

const client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN!);
const db = client.db(process.env.ASTRA_DB_API_ENDPOINT!${keyspaceArg});
const collection = db.collection(${collection});

// Cascade-delete every chunk for this document — the same call AI
// Workbench makes when you delete a document from a knowledge base.
const { deletedCount } = await collection.deleteMany({ documentId: ${docId} });
console.log("deleted", deletedCount, "chunks");
`;
}

function generateDeleteByDocumentPython(
	s: AstraDeleteByDocumentSnapshot,
): string {
	const collection = pyString(s.collection);
	const keyspaceArg = s.keyspace ? `, keyspace=${pyString(s.keyspace)}` : "";
	const docId = pyString(s.filter.documentId);
	return `import os
from astrapy import DataAPIClient

client = DataAPIClient(os.environ["ASTRA_DB_APPLICATION_TOKEN"])
database = client.get_database(
    os.environ["ASTRA_DB_API_ENDPOINT"]${keyspaceArg},
)
collection = database.get_collection(${collection})

# Cascade-delete every chunk for this document — the same call AI
# Workbench makes when you delete a document from a knowledge base.
result = collection.delete_many({"documentId": ${docId}})
print("deleted", result.deleted_count, "chunks")
`;
}

function generateDeleteByDocumentJava(
	s: AstraDeleteByDocumentSnapshot,
): string {
	const collection = javaString(s.collection);
	const keyspaceCall = s.keyspace ? `, ${javaString(s.keyspace)}` : "";
	const docId = javaString(s.filter.documentId);
	return `import com.datastax.astra.client.DataAPIClient;
import com.datastax.astra.client.databases.Database;
import com.datastax.astra.client.collections.Collection;
import com.datastax.astra.client.core.query.Filters;
import com.fasterxml.jackson.databind.JsonNode;

DataAPIClient client = new DataAPIClient(System.getenv("ASTRA_DB_APPLICATION_TOKEN"));
Database db = client.getDatabase(System.getenv("ASTRA_DB_API_ENDPOINT")${keyspaceCall});
Collection<JsonNode> collection = db.getCollection(${collection}, JsonNode.class);

// Cascade-delete every chunk for this document — the same call AI
// Workbench makes when you delete a document from a knowledge base.
var result = collection.deleteMany(Filters.eq("documentId", ${docId}));
System.out.println("deleted " + result.getDeletedCount() + " chunks");
`;
}

function generateDeleteByDocumentCurl(
	s: AstraDeleteByDocumentSnapshot,
): string {
	const body = JSON.stringify(
		{
			deleteMany: {
				filter: { documentId: s.filter.documentId },
			},
		},
		null,
		2,
	);
	const keyspaceSegment = s.keyspace ? `/${s.keyspace}` : "";
	return `# Replace ASTRA_DB_API_ENDPOINT + ASTRA_DB_APPLICATION_TOKEN with the
# values for your database. Cascade-delete every chunk for this
# document — the same call AI Workbench makes on document delete.
curl -sS -X POST "$ASTRA_DB_API_ENDPOINT/api/json/v1${keyspaceSegment}/${s.collection}" \\
  -H "Content-Type: application/json" \\
  -H "Token: $ASTRA_DB_APPLICATION_TOKEN" \\
  --data '${escapeCurlBody(body)}'
`;
}

/* ---------------- delete_chunk generators ----------------
 *
 * Single-chunk delete by `_id`. Used by drivers that don't expose
 * `deleteMany` and by surfaces that drop one chunk at a time.
 */

function generateDeleteChunkTypeScript(s: AstraDeleteChunkSnapshot): string {
	const collection = jsString(s.collection);
	const keyspaceArg = s.keyspace
		? `, { keyspace: ${jsString(s.keyspace)} }`
		: "";
	const chunkId = jsString(s.filter.chunkId);
	return `import { DataAPIClient } from "@datastax/astra-db-ts";

const client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN!);
const db = client.db(process.env.ASTRA_DB_API_ENDPOINT!${keyspaceArg});
const collection = db.collection(${collection});

// Drop a single chunk by _id — the fallback AI Workbench uses when
// the underlying client doesn't expose deleteMany.
const { deletedCount } = await collection.deleteOne({ _id: ${chunkId} });
console.log("deleted", deletedCount);
`;
}

function generateDeleteChunkPython(s: AstraDeleteChunkSnapshot): string {
	const collection = pyString(s.collection);
	const keyspaceArg = s.keyspace ? `, keyspace=${pyString(s.keyspace)}` : "";
	const chunkId = pyString(s.filter.chunkId);
	return `import os
from astrapy import DataAPIClient

client = DataAPIClient(os.environ["ASTRA_DB_APPLICATION_TOKEN"])
database = client.get_database(
    os.environ["ASTRA_DB_API_ENDPOINT"]${keyspaceArg},
)
collection = database.get_collection(${collection})

# Drop a single chunk by _id — the fallback AI Workbench uses when
# the underlying client doesn't expose delete_many.
result = collection.delete_one({"_id": ${chunkId}})
print("deleted", result.deleted_count)
`;
}

function generateDeleteChunkJava(s: AstraDeleteChunkSnapshot): string {
	const collection = javaString(s.collection);
	const keyspaceCall = s.keyspace ? `, ${javaString(s.keyspace)}` : "";
	const chunkId = javaString(s.filter.chunkId);
	return `import com.datastax.astra.client.DataAPIClient;
import com.datastax.astra.client.databases.Database;
import com.datastax.astra.client.collections.Collection;
import com.datastax.astra.client.core.query.Filters;
import com.fasterxml.jackson.databind.JsonNode;

DataAPIClient client = new DataAPIClient(System.getenv("ASTRA_DB_APPLICATION_TOKEN"));
Database db = client.getDatabase(System.getenv("ASTRA_DB_API_ENDPOINT")${keyspaceCall});
Collection<JsonNode> collection = db.getCollection(${collection}, JsonNode.class);

// Drop a single chunk by _id — the fallback AI Workbench uses when
// the underlying client doesn't expose deleteMany.
var result = collection.deleteOne(Filters.eq("_id", ${chunkId}));
System.out.println("deleted " + result.getDeletedCount());
`;
}

function generateDeleteChunkCurl(s: AstraDeleteChunkSnapshot): string {
	const body = JSON.stringify(
		{
			deleteOne: {
				filter: { _id: s.filter.chunkId },
			},
		},
		null,
		2,
	);
	const keyspaceSegment = s.keyspace ? `/${s.keyspace}` : "";
	return `# Replace ASTRA_DB_API_ENDPOINT + ASTRA_DB_APPLICATION_TOKEN with the
# values for your database. Drop a single chunk by _id.
curl -sS -X POST "$ASTRA_DB_API_ENDPOINT/api/json/v1${keyspaceSegment}/${s.collection}" \\
  -H "Content-Type: application/json" \\
  -H "Token: $ASTRA_DB_APPLICATION_TOKEN" \\
  --data '${escapeCurlBody(body)}'
`;
}

/* ---------------- string + literal escapers ---------------- */

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

/**
 * Escape a JSON body for embedding inside a single-quoted shell
 * argument (`'...'`). Single quotes in the body — rare but possible
 * in user-supplied collection names or chunk text — get the
 * `'\''` shell-escape sequence so the entire body survives bash's
 * single-quote rules intact.
 */
function escapeCurlBody(body: string): string {
	return body.replace(/'/g, "'\\''");
}

/**
 * Render a JS object as a Python dict literal. Recursive; handles
 * strings, numbers, booleans, plain objects, and arrays. Used by the
 * create-collection Python generator so the `definition=` payload
 * matches the structure operators would write by hand.
 */
function pyDict(value: unknown, indent: number): string {
	const pad = " ".repeat(indent);
	if (value === null) return "None";
	if (typeof value === "string") return pyString(value);
	if (typeof value === "number" || typeof value === "boolean") {
		if (typeof value === "boolean") return value ? "True" : "False";
		return String(value);
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const inner = value
			.map((v) => `${" ".repeat(indent + 4)}${pyDict(v, indent + 4)}`)
			.join(",\n");
		return `[\n${inner},\n${pad}]`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0) return "{}";
		const inner = entries
			.map(
				([k, v]) =>
					`${" ".repeat(indent + 4)}${pyString(k)}: ${pyDict(v, indent + 4)}`,
			)
			.join(",\n");
		return `{\n${inner},\n${pad}}`;
	}
	return "None";
}
