import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../../src/ingest/extractors/index.js";
import { ApiError } from "../../src/lib/errors.js";
import { parseIngestFileForm } from "../../src/routes/api-v1/ingest-file-form.js";

// Real registry (docling disabled) — the native text extractor handles
// the plain-text fixtures below, exactly like the HTTP file-route test.
const extractors = createExtractorRegistry({ docling: null });

/** Build a multipart form; `file` is `[contents, filename]`, others are strings. */
function formWith(
	fields: Record<string, string | readonly [string, string]>,
): FormData {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (typeof value === "string") {
			form.append(key, value);
		} else {
			form.append(key, new Blob([value[0]], { type: "text/plain" }), value[1]);
		}
	}
	return form;
}

/** Resolve to the thrown ApiError, or fail if the call didn't throw. */
async function caught(p: Promise<unknown>): Promise<ApiError> {
	try {
		await p;
	} catch (err) {
		return err as ApiError;
	}
	throw new Error("expected parseIngestFileForm to throw");
}

describe("parseIngestFileForm", () => {
	it("extracts text and stamps parser provenance into metadata", async () => {
		const parsed = await parseIngestFileForm(
			formWith({ file: ["hello world", "doc.txt"] }),
			extractors,
		);
		expect(parsed.text).toContain("hello world");
		expect(parsed.sourceFilename).toBe("doc.txt");
		expect(parsed.fileType).toBe("text/plain");
		expect(parsed.fileSize).toBeGreaterThan(0);
		expect(parsed.overwriteOnNameConflict).toBe(false);
		// Provenance key is always stamped, even without caller metadata.
		expect(typeof parsed.metadata.ingestParser).toBe("string");
		// Optional fields stay absent when the form omits them.
		expect(parsed.documentId).toBeUndefined();
		expect(parsed.callerVisibleTo).toBeUndefined();
	});

	it("parses caller metadata, chunker, visibleTo, and flags", async () => {
		const parsed = await parseIngestFileForm(
			formWith({
				file: ["body", "notes.txt"],
				metadata: '{"source":"upload"}',
				chunker: '{"maxChunkSize":800}',
				visibleTo: '["alice","bob"]',
				ownerPrincipalId: "alice",
				overwriteOnNameConflict: "true",
				documentId: "11111111-2222-3333-4444-555555555555",
				sourceDocId: "ext-7",
			}),
			extractors,
		);
		expect(parsed.metadata.source).toBe("upload");
		// Caller metadata coexists with the stamped provenance key.
		expect(typeof parsed.metadata.ingestParser).toBe("string");
		expect(parsed.chunker).toEqual({ maxChunkSize: 800 });
		expect(parsed.callerVisibleTo).toEqual(["alice", "bob"]);
		expect(parsed.ownerPrincipalId).toBe("alice");
		expect(parsed.overwriteOnNameConflict).toBe(true);
		expect(parsed.documentId).toBe("11111111-2222-3333-4444-555555555555");
		expect(parsed.sourceDocId).toBe("ext-7");
	});

	it("rejects a missing file field with 400 missing_file", async () => {
		const err = await caught(
			parseIngestFileForm(formWith({ parser: "native" }), extractors),
		);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.code).toBe("missing_file");
		expect(err.status).toBe(400);
	});

	it("rejects an empty file with 400 empty_file", async () => {
		const err = await caught(
			parseIngestFileForm(formWith({ file: ["", "empty.txt"] }), extractors),
		);
		expect(err.code).toBe("empty_file");
		expect(err.status).toBe(400);
	});

	it("rejects an unknown parser with 400 invalid_parser", async () => {
		const err = await caught(
			parseIngestFileForm(
				formWith({ file: ["x", "x.txt"], parser: "magic" }),
				extractors,
			),
		);
		expect(err.code).toBe("invalid_parser");
		expect(err.status).toBe(400);
	});

	it("rejects malformed metadata JSON with 400 invalid_metadata", async () => {
		const err = await caught(
			parseIngestFileForm(
				formWith({ file: ["x", "x.txt"], metadata: "{not json" }),
				extractors,
			),
		);
		expect(err.code).toBe("invalid_metadata");
		expect(err.status).toBe(400);
	});

	it("rejects a non-string-array visibleTo with 400 invalid_visible_to", async () => {
		const err = await caught(
			parseIngestFileForm(
				formWith({ file: ["x", "x.txt"], visibleTo: '"alice"' }),
				extractors,
			),
		);
		expect(err.code).toBe("invalid_visible_to");
		expect(err.status).toBe(400);
	});
});
