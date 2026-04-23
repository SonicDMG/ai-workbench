import { describe, expect, test } from "vitest";
import {
	catalogFromRow,
	catalogToRow,
	documentFromRow,
	documentToRow,
	vectorStoreFromRow,
	vectorStoreToRow,
	workspaceFromRow,
	workspaceToRow,
} from "../../src/astra-client/converters.js";
import type {
	CatalogRecord,
	DocumentRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../src/control-plane/types.js";

const WS: WorkspaceRecord = {
	uid: "11111111-2222-3333-4444-555555555555",
	name: "prod",
	endpoint: "https://prod.example",
	kind: "astra",
	credentialsRef: { token: "env:ASTRA_TOKEN", scb: "file:/etc/scb.zip" },
	keyspace: "workbench",
	createdAt: "2026-04-22T00:00:00.000Z",
	updatedAt: "2026-04-22T00:00:01.000Z",
};

const CAT: CatalogRecord = {
	workspace: WS.uid,
	uid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
	name: "support",
	description: "support docs",
	vectorStore: "ffffffff-0000-1111-2222-333333333333",
	createdAt: "2026-04-22T00:00:02.000Z",
	updatedAt: "2026-04-22T00:00:03.000Z",
};

const VS: VectorStoreRecord = {
	workspace: WS.uid,
	uid: "ffffffff-0000-1111-2222-333333333333",
	name: "vs",
	vectorDimension: 1536,
	vectorSimilarity: "cosine",
	embedding: {
		provider: "openai",
		model: "text-embedding-3-small",
		endpoint: null,
		dimension: 1536,
		secretRef: "env:OPENAI_API_KEY",
	},
	lexical: { enabled: true, analyzer: "standard", options: { k1: "1.2" } },
	reranking: {
		enabled: true,
		provider: "cohere",
		model: "rerank-v3.5",
		endpoint: "https://rerank.example",
		secretRef: "env:COHERE_API_KEY",
	},
	createdAt: "2026-04-22T00:00:04.000Z",
	updatedAt: "2026-04-22T00:00:05.000Z",
};

const DOC: DocumentRecord = {
	workspace: WS.uid,
	catalogUid: CAT.uid,
	documentUid: "99999999-8888-7777-6666-555555555555",
	sourceDocId: "doc-abc",
	sourceFilename: "report.pdf",
	fileType: "application/pdf",
	fileSize: 42_000,
	md5Hash: "d41d8cd98f00b204e9800998ecf8427e",
	chunkTotal: 5,
	ingestedAt: "2026-04-22T00:00:06.000Z",
	updatedAt: "2026-04-22T00:00:07.000Z",
	status: "ready",
	errorMessage: null,
	metadata: { author: "Ada", lang: "en" },
};

describe("converters — round-trip equivalence", () => {
	test("workspace", () => {
		expect(workspaceFromRow(workspaceToRow(WS))).toEqual(WS);
	});

	test("catalog", () => {
		expect(catalogFromRow(catalogToRow(CAT))).toEqual(CAT);
	});

	test("vectorStore", () => {
		expect(vectorStoreFromRow(vectorStoreToRow(VS))).toEqual(VS);
	});

	test("document", () => {
		expect(documentFromRow(documentToRow(DOC))).toEqual(DOC);
	});
});

describe("converters — row shape is snake_case and flat", () => {
	test("workspace row fields", () => {
		const row = workspaceToRow(WS);
		expect(row).toMatchObject({
			uid: WS.uid,
			credentials_ref: WS.credentialsRef,
			created_at: WS.createdAt,
			updated_at: WS.updatedAt,
		});
		expect(row).not.toHaveProperty("credentialsRef");
		expect(row).not.toHaveProperty("createdAt");
	});

	test("vector store flattens embedding/lexical/reranking", () => {
		const row = vectorStoreToRow(VS);
		expect(row).toMatchObject({
			embedding_provider: "openai",
			embedding_model: "text-embedding-3-small",
			embedding_dimension: 1536,
			embedding_secret_ref: "env:OPENAI_API_KEY",
			lexical_enabled: true,
			lexical_analyzer: "standard",
			lexical_options: { k1: "1.2" },
			reranking_enabled: true,
			reranking_provider: "cohere",
		});
		expect(row).not.toHaveProperty("embedding");
		expect(row).not.toHaveProperty("lexical");
		expect(row).not.toHaveProperty("reranking");
	});

	test("document uses catalog_uid / document_uid keys", () => {
		const row = documentToRow(DOC);
		expect(row.catalog_uid).toBe(DOC.catalogUid);
		expect(row.document_uid).toBe(DOC.documentUid);
		expect(row).not.toHaveProperty("catalogUid");
	});
});

describe("converters — null/undefined handling", () => {
	test("workspace with empty credentialsRef produces empty map row", () => {
		const wsEmpty: WorkspaceRecord = { ...WS, credentialsRef: {} };
		const row = workspaceToRow(wsEmpty);
		expect(row.credentials_ref).toEqual({});
	});

	test("vector store with null endpoint round-trips to null", () => {
		expect(
			vectorStoreFromRow(vectorStoreToRow(VS)).embedding.endpoint,
		).toBeNull();
	});

	test("document with missing metadata defaults to empty on fromRow", () => {
		const row = documentToRow(DOC);
		// @ts-expect-error — simulate a row returned by Astra without the map field
		row.metadata = undefined;
		expect(documentFromRow(row).metadata).toEqual({});
	});
});
