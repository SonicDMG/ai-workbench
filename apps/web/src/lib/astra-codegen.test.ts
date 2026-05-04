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
