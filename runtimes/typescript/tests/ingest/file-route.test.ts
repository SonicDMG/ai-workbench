/**
 * Integration coverage for the multipart `/ingest/file` route.
 *
 * Exercises the route end-to-end: multipart parse →
 * extractor dispatcher → ingest service → response envelope. The
 * pdfjs-dist + mammoth libraries are real, not mocked — the round-
 * trip test feeds a tiny hand-built PDF in and expects the embedded
 * text to come back through chunks. Docling-serve is exercised via a
 * stubbed `fetch`.
 */

import { describe, expect, test, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { AuthResolver } from "../../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { createExtractorRegistry } from "../../src/ingest/extractors/index.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

interface AppHarness {
	readonly app: ReturnType<typeof createApp>;
	readonly driver: MockVectorStoreDriver;
}

function makeApp(
	opts: {
		readonly extractors?: ReturnType<typeof createExtractorRegistry>;
	} = {},
): AppHarness {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "disabled",
		anonymousPolicy: "allow",
		verifiers: [],
	});
	const embedders = makeFakeEmbedderFactory();
	const extractors =
		opts.extractors ?? createExtractorRegistry({ docling: null });
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		extractors,
	});
	return { app, driver };
}

async function setupKb(harness: AppHarness): Promise<{
	ws: string;
	kbId: string;
}> {
	const wsRes = await harness.app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(wsRes.status).toBe(201);
	const ws = (await json(wsRes)).workspaceId as string;

	const embRes = await harness.app.request(
		`/api/v1/workspaces/${ws}/embedding-services`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "fake-emb",
				provider: "openai",
				modelName: "text-embedding-3-small",
				embeddingDimension: 8,
			}),
		},
	);
	expect(embRes.status).toBe(201);
	const embId = (await json(embRes)).embeddingServiceId as string;

	const chunkRes = await harness.app.request(
		`/api/v1/workspaces/${ws}/chunking-services`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "in-process",
				engine: "langchain_ts",
				strategy: "recursive",
				maxChunkSize: 200,
				minChunkSize: 0,
				overlapSize: 0,
			}),
		},
	);
	expect(chunkRes.status).toBe(201);
	const chunkId = (await json(chunkRes)).chunkingServiceId as string;

	const kbRes = await harness.app.request(
		`/api/v1/workspaces/${ws}/knowledge-bases`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "kb",
				embeddingServiceId: embId,
				chunkingServiceId: chunkId,
			}),
		},
	);
	expect(kbRes.status).toBe(201);
	const kbId = (await json(kbRes)).knowledgeBaseId as string;
	return { ws, kbId };
}

/** Minimal hand-built single-page PDF whose body contains `Hello extractor world!`. */
const HELLO_PDF_BASE64 =
	"JVBERi0xLjQKJcKlwrHDqwoxIDAgb2JqCjw8IC9UeXBlIC9DYXRhbG9nIC9QYWdlcyAyIDAgUiA+PgplbmRvYmoKMiAwIG9iago8PCAvVHlwZSAvUGFnZXMgL0tpZHMgWzMgMCBSXSAvQ291bnQgMSA+PgplbmRvYmoKMyAwIG9iago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDYxMiA3OTJdIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgL0YxIDUgMCBSID4+ID4+IC9Db250ZW50cyA0IDAgUiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDUyID4+CnN0cmVhbQpCVCAvRjEgMTggVGYgMCA3MDAgVGQgKEhlbGxvIGV4dHJhY3RvciB3b3JsZCEpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNyAwMDAwMCBuIAowMDAwMDAwMDY2IDAwMDAwIG4gCjAwMDAwMDAxMjMgMDAwMDAgbiAKMDAwMDAwMDI0OSAwMDAwMCBuIAowMDAwMDAwMzUxIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDIxCiUlRU9GCg==";

function helloPdf(): Uint8Array<ArrayBuffer> {
	const bin = atob(HELLO_PDF_BASE64);
	const buf = new ArrayBuffer(bin.length);
	const out = new Uint8Array(buf);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

describe("POST .../ingest/file (multipart)", () => {
	test("ingests a plain text upload via the native text extractor", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const form = new FormData();
		form.append(
			"file",
			new Blob(["alpha bravo charlie delta. ".repeat(40)], {
				type: "text/plain",
			}),
			"sample.txt",
		);

		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest/file`,
			{ method: "POST", body: form },
		);
		expect(res.status, await res.clone().text()).toBe(201);
		const body = await json(res);
		expect(body.chunks).toBeGreaterThan(0);
		expect(body.document.sourceFilename).toBe("sample.txt");
		// Provenance metadata is stamped onto the document so the UI
		// can show "extracted via native pipeline" without re-running
		// the dispatcher.
		expect(body.document.metadata.ingestParser).toBe("native");
	});

	test("rejects an unsupported binary upload with 415", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const form = new FormData();
		form.append(
			"file",
			new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
				type: "image/png",
			}),
			"icon.png",
		);

		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest/file`,
			{ method: "POST", body: form },
		);
		expect(res.status).toBe(415);
		const body = await json(res);
		expect(body.error.code).toBe("unsupported_file_type");
	});

	test("rejects an empty file with 400", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const form = new FormData();
		form.append("file", new Blob([], { type: "text/plain" }), "empty.txt");

		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest/file`,
			{ method: "POST", body: form },
		);
		expect(res.status).toBe(400);
		expect((await json(res)).error.code).toBe("empty_file");
	});

	test("rejects a request with no file field with 400", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const form = new FormData();
		form.append("parser", "native");

		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest/file`,
			{ method: "POST", body: form },
		);
		expect(res.status).toBe(400);
		expect((await json(res)).error.code).toBe("missing_file");
	});

	test("rejects an invalid parser value with 400", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const form = new FormData();
		form.append("file", new Blob(["x"], { type: "text/plain" }), "x.txt");
		form.append("parser", "magic");

		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest/file`,
			{ method: "POST", body: form },
		);
		expect(res.status).toBe(400);
		expect((await json(res)).error.code).toBe("invalid_parser");
	});

	test("round-trips a real XLSX through exceljs", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const ExcelJS = await import("exceljs");
		const wb = new ExcelJS.default.Workbook();
		const sheet = wb.addWorksheet("Inventory");
		sheet.addRow(["SKU", "Name", "Qty"]);
		sheet.addRow(["A-001", "Widget alpha", 12]);
		sheet.addRow(["A-002", "Widget beta", 7]);
		const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

		const form = new FormData();
		form.append(
			"file",
			new Blob([new Uint8Array(xlsxBuffer)], {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}),
			"inventory.xlsx",
		);

		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest/file`,
			{ method: "POST", body: form },
		);
		expect(res.status, await res.clone().text()).toBe(201);
		const body = await json(res);
		expect(body.chunks).toBeGreaterThan(0);
		expect(body.document.metadata.ingestParser).toBe("native");
		expect(body.document.metadata.ingestParserVersion).toBe("exceljs");

		const chunksRes = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${body.document.documentId}/chunks`,
		);
		expect(chunksRes.status).toBe(200);
		const chunks = (await json(chunksRes)) as Array<{ text: string }>;
		const joined = chunks.map((c) => c.text).join(" ");
		expect(joined).toContain("Inventory");
		expect(joined).toContain("Widget alpha");
		expect(joined).toContain("A-001");
	});

	test("round-trips a real PDF through pdfjs-dist", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const form = new FormData();
		form.append(
			"file",
			new Blob([helloPdf()], { type: "application/pdf" }),
			"hello.pdf",
		);

		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest/file`,
			{ method: "POST", body: form },
		);
		expect(res.status, await res.clone().text()).toBe(201);
		const body = await json(res);
		expect(body.chunks).toBeGreaterThan(0);
		expect(body.document.metadata.ingestParser).toBe("native");
		expect(body.document.metadata.ingestParserVersion).toMatch(/^pdfjs-dist/);

		// Pull the chunk text back through the chunks listing route to
		// confirm the extracted body actually flowed through chunk +
		// upsert.
		const chunksRes = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${body.document.documentId}/chunks`,
		);
		expect(chunksRes.status).toBe(200);
		const chunks = (await json(chunksRes)) as Array<{ text: string }>;
		const joined = chunks.map((c) => c.text).join(" ");
		expect(joined).toContain("Hello");
		expect(joined).toContain("extractor");
	});

	test("routes to docling-serve when configured and parser=docling", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					document: {
						md_content: "# Heading\n\nDocling-extracted body text. ".repeat(20),
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		try {
			const extractors = createExtractorRegistry({
				docling: { baseUrl: "http://docling.test", timeoutMs: 1000 },
			});
			const harness = makeApp({ extractors });
			const { ws, kbId } = await setupKb(harness);

			const form = new FormData();
			form.append(
				"file",
				new Blob([helloPdf()], { type: "application/pdf" }),
				"report.pdf",
			);
			form.append("parser", "docling");

			const res = await harness.app.request(
				`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest/file`,
				{ method: "POST", body: form },
			);
			expect(res.status, await res.clone().text()).toBe(201);
			const body = await json(res);
			expect(body.document.metadata.ingestParser).toBe("docling");
			// Most of the spy's calls are docling; the harness's app.request
			// shouldn't have used global fetch at all.
			expect(fetchSpy).toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
