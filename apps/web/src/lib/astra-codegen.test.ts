/**
 * Snapshot-style tests for the Astra-query code generators. Pin the
 * essentials of each language's output (correct call shapes, query
 * text + topK + collection round-trip, no token literals leaked) so
 * we don't accidentally regress when one of the SDK signatures
 * changes.
 */

import { describe, expect, test } from "vitest";
import { generateCode } from "./astra-codegen";
import type { AstraQuerySnapshot } from "./schemas";

const sampleSnapshot: AstraQuerySnapshot = {
	kind: "vector_search",
	knowledgeBaseId: "kb-1",
	kbName: "Engineering Docs",
	collection: "wb_vectors_kb_eng",
	keyspace: "default_keyspace",
	query: { text: "what is RAG?", topK: 5 },
};

describe("astra-codegen", () => {
	test("typescript snippet includes the SDK import, vectorize sort, and limit", () => {
		const code = generateCode("typescript", sampleSnapshot);
		expect(code).toContain("@datastax/astra-db-ts");
		expect(code).toContain("DataAPIClient");
		expect(code).toContain('"wb_vectors_kb_eng"');
		expect(code).toContain('"what is RAG?"');
		expect(code).toContain("limit: 5");
		expect(code).toContain('keyspace: "default_keyspace"');
		// No token literals — must be env-resolved.
		expect(code).not.toContain("AstraCS:");
	});

	test("python snippet uses astrapy and the correct kwargs", () => {
		const code = generateCode("python", sampleSnapshot);
		expect(code).toContain("from astrapy import DataAPIClient");
		expect(code).toContain('os.environ["ASTRA_DB_APPLICATION_TOKEN"]');
		expect(code).toContain('"$vectorize": "what is RAG?"');
		expect(code).toContain("limit=5");
		expect(code).toContain('keyspace="default_keyspace"');
	});

	test("java snippet imports the right packages + uses CollectionFindOptions", () => {
		const code = generateCode("java", sampleSnapshot);
		expect(code).toContain("com.datastax.astra.client.DataAPIClient");
		expect(code).toContain("CollectionFindOptions");
		expect(code).toContain('Sort.vectorize("what is RAG?")');
		expect(code).toContain(".limit(5)");
		expect(code).toContain('"default_keyspace"');
	});

	test("curl snippet posts to the Data API with token + body containing the query", () => {
		const code = generateCode("curl", sampleSnapshot);
		expect(code).toContain("curl");
		expect(code).toContain(
			"$ASTRA_DB_API_ENDPOINT/api/json/v1/default_keyspace/wb_vectors_kb_eng",
		);
		expect(code).toContain('"Token: $ASTRA_DB_APPLICATION_TOKEN"');
		expect(code).toContain('"$vectorize": "what is RAG?"');
		expect(code).toContain('"limit": 5');
	});

	test("escapes a query with quotes and backslashes safely in every language", () => {
		const tricky: AstraQuerySnapshot = {
			...sampleSnapshot,
			kind: "vector_search",
			query: { text: 'has "quotes" and \\ backslash', topK: 3 },
		};
		const ts = generateCode("typescript", tricky);
		expect(ts).toContain('"has \\"quotes\\" and \\\\ backslash"');
		const py = generateCode("python", tricky);
		expect(py).toContain('"has \\"quotes\\" and \\\\ backslash"');
		const java = generateCode("java", tricky);
		expect(java).toContain('"has \\"quotes\\" and \\\\ backslash"');
		const curl = generateCode("curl", tricky);
		// JSON-encoded body — same escape rules.
		expect(curl).toContain('has \\"quotes\\" and \\\\ backslash');
	});

	test("omits keyspace cleanly when null", () => {
		const noKs: AstraQuerySnapshot = {
			...sampleSnapshot,
			keyspace: null,
		};
		const ts = generateCode("typescript", noKs);
		expect(ts).not.toContain("keyspace:");
		const py = generateCode("python", noKs);
		expect(py).not.toContain("keyspace=");
		const curl = generateCode("curl", noKs);
		// Double slash in URL would be wrong; keyspace segment stripped.
		expect(curl).not.toContain("/v1//");
		expect(curl).toContain("/v1/wb_vectors_kb_eng");
	});
});

describe("astra-codegen — list_chunks variant", () => {
	const listChunksSnapshot: AstraQuerySnapshot = {
		kind: "list_chunks",
		knowledgeBaseId: "kb-1",
		kbName: "Engineering Docs",
		collection: "wb_vectors_kb_eng",
		keyspace: "default_keyspace",
		query: {
			documentId: "11111111-1111-4111-8111-111111111111",
			limit: 10,
			offset: 0,
		},
	};

	test("typescript snippet filters by documentId, sorts by chunkIndex, no skip on offset 0", () => {
		const code = generateCode("typescript", listChunksSnapshot);
		expect(code).toContain(
			'documentId: "11111111-1111-4111-8111-111111111111"',
		);
		expect(code).toContain("sort: { chunkIndex: 1 }");
		expect(code).toContain("limit: 10");
		// No `skip: 0` clutter when offset is the default.
		expect(code).not.toContain("skip:");
		// `$vectorize` must NOT appear — this is a positional read.
		expect(code).not.toContain("$vectorize");
	});

	test("python snippet uses chunkIndex sort + limit", () => {
		const code = generateCode("python", listChunksSnapshot);
		expect(code).toContain(
			'"documentId": "11111111-1111-4111-8111-111111111111"',
		);
		expect(code).toContain('"chunkIndex": 1');
		expect(code).toContain("limit=10");
		expect(code).not.toContain("$vectorize");
	});

	test("java snippet uses Filters.eq + Sort.ascending", () => {
		const code = generateCode("java", listChunksSnapshot);
		expect(code).toContain(
			'Filters.eq("documentId", "11111111-1111-4111-8111-111111111111")',
		);
		expect(code).toContain('Sort.ascending("chunkIndex")');
		expect(code).toContain(".limit(10)");
		expect(code).not.toContain("$vectorize");
	});

	test("curl encodes filter + sort in the find body", () => {
		const code = generateCode("curl", listChunksSnapshot);
		expect(code).toContain(
			'"documentId": "11111111-1111-4111-8111-111111111111"',
		);
		expect(code).toContain('"chunkIndex": 1');
		expect(code).toContain('"limit": 10');
		expect(code).not.toContain('"$vectorize"');
	});

	test("offset > 0 surfaces as skip in every language", () => {
		const withOffset: AstraQuerySnapshot = {
			...listChunksSnapshot,
			kind: "list_chunks",
			query: { ...listChunksSnapshot.query, offset: 25 },
		};
		expect(generateCode("typescript", withOffset)).toContain("skip: 25");
		expect(generateCode("python", withOffset)).toContain("skip=25");
		expect(generateCode("java", withOffset)).toContain(".skip(25)");
		expect(generateCode("curl", withOffset)).toContain('"skip": 25');
	});
});

/* ---------------- create_collection variant ----------------
 *
 * The create call is the most option-heavy: vector dimension +
 * metric + optional $vectorize service + optional lexical analyzer +
 * optional rerank service. The tests pin the conditional emission so
 * an opt-in toggle never leaks into a snippet for a KB that didn't
 * enable it.
 */

describe("astra-codegen — create_collection variant", () => {
	const fullCreate: AstraQuerySnapshot = {
		kind: "create_collection",
		knowledgeBaseId: "kb-1",
		kbName: "Engineering Docs",
		collection: "wb_vectors_kb_eng",
		keyspace: "default_keyspace",
		options: {
			vectorDimension: 1536,
			vectorMetric: "cosine",
			vectorize: { provider: "openai", modelName: "text-embedding-3-small" },
			lexical: { enabled: true, analyzer: "standard" },
			rerank: {
				enabled: true,
				provider: "nvidia",
				modelName: "nv-rerankqa-mistral-4b-v3",
			},
		},
	};

	test("typescript snippet emits createCollection with all options", () => {
		const code = generateCode("typescript", fullCreate);
		expect(code).toContain("db.createCollection");
		expect(code).toContain('"wb_vectors_kb_eng"');
		expect(code).toContain("dimension: 1536");
		expect(code).toContain('metric: "cosine"');
		expect(code).toContain(
			'service: { provider: "openai", modelName: "text-embedding-3-small" }',
		);
		expect(code).toContain('analyzer: "standard"');
		expect(code).toContain('provider: "nvidia"');
		expect(code).not.toContain("AstraCS:");
	});

	test("python snippet emits create_collection with definition payload", () => {
		const code = generateCode("python", fullCreate);
		expect(code).toContain("database.create_collection");
		expect(code).toContain('"dimension": 1536');
		expect(code).toContain('"metric": "cosine"');
		expect(code).toContain('"provider": "openai"');
		expect(code).toContain('"model_name": "text-embedding-3-small"');
		expect(code).toContain('"analyzer": "standard"');
	});

	test("java snippet builds CollectionDefinition with vectorize/lexical/rerank", () => {
		const code = generateCode("java", fullCreate);
		expect(code).toContain(".vector(1536, SimilarityMetric.COSINE)");
		expect(code).toContain('.vectorize("openai", "text-embedding-3-small")');
		expect(code).toContain('.lexical("standard")');
		expect(code).toContain('.rerank("nvidia", "nv-rerankqa-mistral-4b-v3")');
		expect(code).toContain('db.createCollection("wb_vectors_kb_eng", def);');
	});

	test("curl posts createCollection with vector/lexical/rerank in options", () => {
		const code = generateCode("curl", fullCreate);
		expect(code).toContain('"createCollection"');
		expect(code).toContain('"name": "wb_vectors_kb_eng"');
		expect(code).toContain('"dimension": 1536');
		expect(code).toContain('"metric": "cosine"');
		expect(code).toContain('"provider": "openai"');
		expect(code).toContain('"analyzer": "standard"');
	});

	test("omits vectorize/lexical/rerank cleanly when off", () => {
		const minimal: AstraQuerySnapshot = {
			...fullCreate,
			options: {
				vectorDimension: 768,
				vectorMetric: "cosine",
				vectorize: null,
				lexical: null,
				rerank: null,
			},
		};
		const ts = generateCode("typescript", minimal);
		expect(ts).not.toContain("service:");
		expect(ts).not.toContain("lexical:");
		expect(ts).not.toContain("rerank:");
		expect(ts).toContain("dimension: 768");
		const py = generateCode("python", minimal);
		expect(py).not.toContain('"service":');
		expect(py).not.toContain('"lexical":');
		expect(py).not.toContain('"rerank":');
		const java = generateCode("java", minimal);
		expect(java).not.toContain(".vectorize(");
		expect(java).not.toContain(".lexical(");
		expect(java).not.toContain(".rerank(");
		const curl = generateCode("curl", minimal);
		expect(curl).not.toContain('"service":');
		expect(curl).not.toContain('"lexical":');
		expect(curl).not.toContain('"rerank":');
	});
});

/* ---------------- insert_chunks variant ---------------- */

describe("astra-codegen — insert_chunks variant", () => {
	const insertSnapshot: AstraQuerySnapshot = {
		kind: "insert_chunks",
		knowledgeBaseId: "kb-1",
		kbName: "Engineering Docs",
		collection: "wb_vectors_kb_eng",
		keyspace: "default_keyspace",
		batch: {
			documentId: "11111111-1111-4111-8111-111111111111",
			batchSize: 50,
		},
	};

	test("typescript snippet emits insertMany with $vectorize + payload keys", () => {
		const code = generateCode("typescript", insertSnapshot);
		expect(code).toContain("collection.insertMany(docs)");
		expect(code).toContain("$vectorize:");
		expect(code).toContain(
			'documentId: "11111111-1111-4111-8111-111111111111"',
		);
		expect(code).toContain("chunkIndex: 0");
		expect(code).toContain("knowledgeBaseId:");
		// Footnote text: tells the user the call repeats per batch
		expect(code).toContain("size 50");
	});

	test("python snippet emits insert_many with $vectorize key", () => {
		const code = generateCode("python", insertSnapshot);
		expect(code).toContain("collection.insert_many(docs)");
		expect(code).toContain('"$vectorize":');
		expect(code).toContain(
			'"documentId": "11111111-1111-4111-8111-111111111111"',
		);
	});

	test("java snippet builds JsonNode docs + insertMany", () => {
		const code = generateCode("java", insertSnapshot);
		expect(code).toContain("collection.insertMany(docs)");
		expect(code).toContain('"$vectorize"');
		expect(code).toContain('"11111111-1111-4111-8111-111111111111"');
	});

	test("curl wraps the doc shape in an insertMany body", () => {
		const code = generateCode("curl", insertSnapshot);
		expect(code).toContain('"insertMany"');
		expect(code).toContain('"$vectorize"');
		expect(code).toContain(
			'"documentId": "11111111-1111-4111-8111-111111111111"',
		);
	});
});

/* ---------------- delete variants ---------------- */

describe("astra-codegen — delete_by_document variant", () => {
	const deleteSnapshot: AstraQuerySnapshot = {
		kind: "delete_by_document",
		knowledgeBaseId: "kb-1",
		kbName: "Engineering Docs",
		collection: "wb_vectors_kb_eng",
		keyspace: "default_keyspace",
		filter: { documentId: "11111111-1111-4111-8111-111111111111" },
	};

	test("typescript snippet uses deleteMany with documentId filter", () => {
		const code = generateCode("typescript", deleteSnapshot);
		expect(code).toContain(
			'collection.deleteMany({ documentId: "11111111-1111-4111-8111-111111111111" })',
		);
	});

	test("python snippet uses delete_many", () => {
		const code = generateCode("python", deleteSnapshot);
		expect(code).toContain(
			'collection.delete_many({"documentId": "11111111-1111-4111-8111-111111111111"})',
		);
	});

	test("java snippet uses Filters.eq", () => {
		const code = generateCode("java", deleteSnapshot);
		expect(code).toContain(
			'collection.deleteMany(Filters.eq("documentId", "11111111-1111-4111-8111-111111111111"))',
		);
	});

	test("curl posts a deleteMany body", () => {
		const code = generateCode("curl", deleteSnapshot);
		expect(code).toContain('"deleteMany"');
		expect(code).toContain(
			'"documentId": "11111111-1111-4111-8111-111111111111"',
		);
	});
});

describe("astra-codegen — delete_chunk variant", () => {
	const chunkDelete: AstraQuerySnapshot = {
		kind: "delete_chunk",
		knowledgeBaseId: "kb-1",
		kbName: "Engineering Docs",
		collection: "wb_vectors_kb_eng",
		keyspace: "default_keyspace",
		filter: { chunkId: "chunk-42" },
	};

	test("typescript snippet uses deleteOne with _id filter", () => {
		const code = generateCode("typescript", chunkDelete);
		expect(code).toContain('collection.deleteOne({ _id: "chunk-42" })');
	});

	test("python snippet uses delete_one with _id key", () => {
		const code = generateCode("python", chunkDelete);
		expect(code).toContain('collection.delete_one({"_id": "chunk-42"})');
	});

	test("java snippet uses Filters.eq on _id", () => {
		const code = generateCode("java", chunkDelete);
		expect(code).toContain(
			'collection.deleteOne(Filters.eq("_id", "chunk-42"))',
		);
	});

	test("curl posts a deleteOne body", () => {
		const code = generateCode("curl", chunkDelete);
		expect(code).toContain('"deleteOne"');
		expect(code).toContain('"_id": "chunk-42"');
	});
});
