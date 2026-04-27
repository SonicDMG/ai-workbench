import { describe, expect, test } from "vitest";
import {
	ragDocumentFromRow,
	ragDocumentToRow,
	workspaceFromRow,
	workspaceToRow,
} from "../../src/astra-client/converters.js";
import type {
	RagDocumentRecord,
	WorkspaceRecord,
} from "../../src/control-plane/types.js";

const WS: WorkspaceRecord = {
	uid: "11111111-2222-3333-4444-555555555555",
	name: "prod",
	url: "https://prod.example",
	kind: "astra",
	credentials: { token: "env:ASTRA_TOKEN", scb: "file:/etc/scb.zip" },
	namespace: "workbench",
	createdAt: "2026-04-22T00:00:00.000Z",
	updatedAt: "2026-04-22T00:00:01.000Z",
};

const KB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const DOC: RagDocumentRecord = {
	workspaceId: WS.uid,
	knowledgeBaseId: KB_ID,
	documentId: "99999999-8888-7777-6666-555555555555",
	sourceDocId: "doc-abc",
	sourceFilename: "report.pdf",
	fileType: "application/pdf",
	fileSize: 42_000,
	contentHash: "sha256:d41d8cd98f00b204e9800998ecf8427e",
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

	test("rag document", () => {
		expect(ragDocumentFromRow(ragDocumentToRow(DOC))).toEqual(DOC);
	});
});

describe("converters — row shape is snake_case and flat", () => {
	test("workspace row fields", () => {
		const row = workspaceToRow(WS);
		expect(row).toMatchObject({
			uid: WS.uid,
			credentials: WS.credentials,
			created_at: WS.createdAt,
			updated_at: WS.updatedAt,
		});
		expect(row).not.toHaveProperty("credentialsRef");
		expect(row).not.toHaveProperty("createdAt");
	});

	test("rag document uses workspace_id / knowledge_base_id / document_id keys", () => {
		const row = ragDocumentToRow(DOC);
		expect(row.workspace_id).toBe(DOC.workspaceId);
		expect(row.knowledge_base_id).toBe(DOC.knowledgeBaseId);
		expect(row.document_id).toBe(DOC.documentId);
		expect(row).not.toHaveProperty("workspaceId");
		expect(row).not.toHaveProperty("knowledgeBaseId");
		expect(row).not.toHaveProperty("documentId");
	});
});

describe("converters — null/undefined handling", () => {
	test("workspace with empty credentials produces empty map row", () => {
		const wsEmpty: WorkspaceRecord = { ...WS, credentials: {} };
		const row = workspaceToRow(wsEmpty);
		expect(row.credentials).toEqual({});
	});

	test("rag document with missing metadata defaults to empty on fromRow", () => {
		const row = ragDocumentToRow(DOC);
		// @ts-expect-error — simulate a row returned by Astra without the map field
		row.metadata = undefined;
		expect(ragDocumentFromRow(row).metadata).toEqual({});
	});
});
