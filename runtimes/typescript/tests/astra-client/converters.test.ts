import { describe, expect, test } from "vitest";
import {
	asIsoString,
	asIsoStringOrNull,
	asNullableUuidString,
	asNumber,
	asNumberOrNull,
	asPlainStringMap,
	asUuidString,
	knowledgeBaseFromRow,
	knowledgeBaseToRow,
	policyAuditFromRow,
	principalFromRow,
	ragDocumentFromRow,
	ragDocumentToRow,
	workspaceFromRow,
	workspaceToRow,
} from "../../src/astra-client/converters.js";
import type {
	PolicyAuditRow,
	PrincipalRow,
} from "../../src/astra-client/row-types.js";
import type {
	KnowledgeBaseRecord,
	RagDocumentRecord,
	WorkspaceRecord,
} from "../../src/control-plane/types.js";

const WS: WorkspaceRecord = {
	uid: "11111111-2222-3333-4444-555555555555",
	name: "prod",
	url: "https://prod.example",
	kind: "astra",
	credentials: { token: "env:ASTRA_TOKEN", scb: "file:/etc/scb.zip" },
	keyspace: "workbench",
	rlacEnabled: false,
	createdAt: "2026-04-22T00:00:00.000Z",
	updatedAt: "2026-04-22T00:00:01.000Z",
};

const KB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const KB: KnowledgeBaseRecord = {
	workspaceId: WS.uid,
	knowledgeBaseId: KB_ID,
	name: "support",
	description: null,
	status: "active",
	embeddingServiceId: "22222222-3333-4444-5555-666666666666",
	chunkingServiceId: "33333333-4444-5555-6666-777777777777",
	rerankingServiceId: null,
	language: "en",
	vectorCollection: "support",
	owned: true,
	lexical: {
		enabled: false,
		analyzer: null,
		options: {},
	},
	policyDsl: null,
	policyEnabled: false,
	createdAt: "2026-04-22T00:00:02.000Z",
	updatedAt: "2026-04-22T00:00:03.000Z",
};

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
	visibleTo: null,
	ownerPrincipalId: null,
};

describe("converters — round-trip equivalence", () => {
	test("workspace", () => {
		expect(workspaceFromRow(workspaceToRow(WS))).toEqual(WS);
	});

	test("rag document", () => {
		expect(ragDocumentFromRow(ragDocumentToRow(DOC))).toEqual(DOC);
	});

	test("knowledge base", () => {
		expect(knowledgeBaseFromRow(knowledgeBaseToRow(KB))).toEqual(KB);
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

	test("workspace with missing url/keyspace coerces to null on fromRow", () => {
		// Simulates a row written before the url/keyspace columns
		// existed (or where the Astra driver returns them as undefined
		// rather than null). Without coercion the WorkspaceRecord
		// would carry `undefined`, which JSON.stringify drops, which
		// then fails the UI's WorkspaceRecordSchema downstream.
		const row = workspaceToRow(WS);
		// @ts-expect-error — simulate a row returned by Astra without these columns
		row.url = undefined;
		// @ts-expect-error
		row.keyspace = undefined;
		const record = workspaceFromRow(row);
		expect(record.url).toBeNull();
		expect(record.keyspace).toBeNull();
	});

	test("workspace with missing credentials map defaults to empty on fromRow", () => {
		const row = workspaceToRow(WS);
		// @ts-expect-error — simulate a row returned by Astra without the map column
		row.credentials = undefined;
		expect(workspaceFromRow(row).credentials).toEqual({});
	});

	test("knowledge base with missing lexical fields defaults on fromRow", () => {
		const row = knowledgeBaseToRow(KB);
		// @ts-expect-error — simulate a row written before the lexical columns existed
		row.lexical_enabled = undefined;
		// @ts-expect-error
		row.lexical_analyzer = undefined;
		// @ts-expect-error
		row.lexical_options = undefined;
		expect(knowledgeBaseFromRow(row).lexical).toEqual({
			enabled: false,
			analyzer: null,
			options: {},
		});
	});
});

/**
 * Tables serdes in `@datastax/astra-db-ts` v2.x hands rows back with
 * runtime-class shapes for `uuid` (a UUID-like instance) and
 * `map<text, text>` (a `Map`). The row-types interface declares
 * these as `string` / `Record<string, string>`, so the converters
 * have to coerce or downstream consumers see `{version, _raw}` JSON
 * blobs and silently-empty credentials maps. These tests guard the
 * coercion path.
 */
describe("converters — Tables serdes runtime-class coercion", () => {
	test("asUuidString unwraps a UUID-like instance via the `_raw` field", () => {
		const uuidLike = {
			version: 4,
			_raw: "11111111-2222-3333-4444-555555555555",
		};
		expect(asUuidString(uuidLike)).toBe("11111111-2222-3333-4444-555555555555");
	});

	test("asUuidString accepts a plain string verbatim", () => {
		expect(asUuidString("abc-def")).toBe("abc-def");
	});

	test("asUuidString accepts an object whose toString is canonical", () => {
		// Mimics the public surface of @datastax/astra-db-ts's `UUID` —
		// `toString()` returns the canonical lowercase form.
		const uuidLike = {
			toString: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		};
		expect(asUuidString(uuidLike)).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
	});

	test("asNullableUuidString preserves null/undefined", () => {
		expect(asNullableUuidString(null)).toBeNull();
		expect(asNullableUuidString(undefined)).toBeNull();
		expect(asNullableUuidString("11111111-2222-3333-4444-555555555555")).toBe(
			"11111111-2222-3333-4444-555555555555",
		);
	});

	test("asPlainStringMap converts a Map to a plain object", () => {
		const m = new Map<string, string>([
			["token", "env:T"],
			["scb", "file:/etc/scb.zip"],
		]);
		expect(asPlainStringMap(m)).toEqual({
			token: "env:T",
			scb: "file:/etc/scb.zip",
		});
	});

	test("asPlainStringMap drops a Map's non-string entries (defensive)", () => {
		const m = new Map<unknown, unknown>([
			["good", "yes"],
			[123, "skipped-bad-key"],
			["skipped-bad-value", { nope: true }],
		]);
		expect(asPlainStringMap(m)).toEqual({ good: "yes" });
	});

	test("asPlainStringMap accepts a plain object as-is", () => {
		expect(asPlainStringMap({ a: "b" })).toEqual({ a: "b" });
	});

	test("asPlainStringMap returns empty for null/undefined/non-object", () => {
		expect(asPlainStringMap(null)).toEqual({});
		expect(asPlainStringMap(undefined)).toEqual({});
		expect(asPlainStringMap(42)).toEqual({});
	});

	test("workspaceFromRow coerces UUID + Map shapes to canonical record", () => {
		// This is the regression that motivated the helpers: workspace
		// list response was returning `workspaceId: {version, _raw}` and
		// `credentials: {}` because the spread of a Map yields no
		// enumerable properties. Both fields had to land as the
		// declared types.
		const row = {
			uid: { version: 4, _raw: "11111111-2222-3333-4444-555555555555" },
			name: "prod",
			url: "https://prod.example",
			kind: "astra" as const,
			keyspace: "workbench",
			credentials: new Map<string, string>([["token", "env:T"]]),
			created_at: "2026-04-22T00:00:00.000Z",
			updated_at: "2026-04-22T00:00:01.000Z",
		};
		// @ts-expect-error — simulate the runtime-class shapes Astra
		// hands us; the typed row interface declares string + object.
		const record = workspaceFromRow(row);
		expect(record.uid).toBe("11111111-2222-3333-4444-555555555555");
		expect(record.credentials).toEqual({ token: "env:T" });
		// JSON serialisation must not leak the runtime-class shape —
		// regression check for the API list response that previously
		// produced `"workspaceId":{"version":4,"_raw":"…"}`.
		const json = JSON.parse(JSON.stringify(record));
		expect(json.uid).toBe("11111111-2222-3333-4444-555555555555");
		expect(json.credentials).toEqual({ token: "env:T" });
	});
});

/**
 * Numeric columns (`int`, `bigint`) come back from astra-db-ts as
 * `BigInt` instances. JSON.stringify rejects those with
 * `TypeError: Do not know how to serialize a BigInt`. The coercer
 * downcasts to `number` (safe for our value ranges) so every API
 * response can serialise cleanly.
 */
describe("converters — numeric column coercion", () => {
	test("asNumber coerces a BigInt to a JS number", () => {
		expect(asNumber(42n)).toBe(42);
	});

	test("asNumber accepts a plain number verbatim", () => {
		expect(asNumber(7)).toBe(7);
	});

	test("asNumber accepts a numeric string", () => {
		expect(asNumber("3.14")).toBe(3.14);
	});

	test("asNumberOrNull preserves null/undefined", () => {
		expect(asNumberOrNull(null)).toBeNull();
		expect(asNumberOrNull(undefined)).toBeNull();
		expect(asNumberOrNull(0n)).toBe(0);
		expect(asNumberOrNull(42)).toBe(42);
	});

	test("ragDocumentFromRow round-trips file_size and chunk_total as numbers", () => {
		// Tables decoder hands `bigint` and `int` columns back as
		// BigInt instances. The record interface declares `number |
		// null`, so without coercion `JSON.stringify(record)` throws.
		const row = ragDocumentToRow({
			workspaceId: "11111111-2222-3333-4444-555555555555",
			knowledgeBaseId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
			documentId: "99999999-8888-7777-6666-555555555555",
			sourceDocId: null,
			sourceFilename: "x.md",
			fileType: null,
			fileSize: 4_096,
			contentHash: null,
			chunkTotal: 5,
			ingestedAt: null,
			updatedAt: "2026-04-22T00:00:01.000Z",
			status: "ready",
			errorMessage: null,
			metadata: {},
			visibleTo: null,
			ownerPrincipalId: null,
		});
		// Simulate the Tables decoder handing back BigInts.
		// @ts-expect-error — row-types declare these as `number`,
		// the decoder violates that.
		row.file_size = 4096n;
		// @ts-expect-error
		row.chunk_total = 5n;
		const record = ragDocumentFromRow(row);
		expect(record.fileSize).toBe(4096);
		expect(record.chunkTotal).toBe(5);
		// Critical: must JSON-serialise without throwing.
		expect(() => JSON.stringify(record)).not.toThrow();
	});
});

/**
 * Schema regression: `messages.tool_id` is `text`, not `uuid`. The
 * runtime stores tool *names* (e.g. "list_kbs") there for built-in
 * chat tools, which don't have a row in `wb_config_mcp_tools_by_workspace`.
 * Storing those into a `uuid` column makes the Data API reject the
 * insert with "Invalid UUID string: list_kbs", which silently breaks
 * the chat-tool persistence pipeline (the assistant's tool_calls
 * land but the matching tool-response messages don't, which then
 * makes OpenAI 400 the next round-trip).
 */
describe("schema — messages.tool_id is text, not uuid", () => {
	test("MESSAGES_DEFINITION declares tool_id as text", async () => {
		const { MESSAGES_DEFINITION } = await import(
			"../../src/astra-client/table-definitions.js"
		);
		expect(MESSAGES_DEFINITION.columns.tool_id).toBe("text");
	});
});

describe("converters — Date → ISO coercion for RLAC tables", () => {
	test("asIsoString returns a string verbatim", () => {
		expect(asIsoString("2026-05-14T18:44:22.025Z")).toBe(
			"2026-05-14T18:44:22.025Z",
		);
	});

	test("asIsoString converts a JS Date to ISO-8601", () => {
		const date = new Date(Date.UTC(2026, 4, 14, 18, 44, 22, 25));
		expect(asIsoString(date)).toBe("2026-05-14T18:44:22.025Z");
	});

	test("asIsoString accepts an object with toISOString()", () => {
		const dateLike = {
			toISOString: () => "2026-05-14T18:44:22.025Z",
		};
		expect(asIsoString(dateLike)).toBe("2026-05-14T18:44:22.025Z");
	});

	test("asIsoStringOrNull preserves null/undefined", () => {
		expect(asIsoStringOrNull(null)).toBeNull();
		expect(asIsoStringOrNull(undefined)).toBeNull();
		expect(asIsoStringOrNull("2026-05-14T18:44:22.025Z")).toBe(
			"2026-05-14T18:44:22.025Z",
		);
	});

	test("policyAuditFromRow coerces ts from Date to ISO string", () => {
		// astra-db-ts decodes `timestamp` columns as `Date` instances —
		// the audit-list code sorts on `record.ts`, so leaving it as a
		// Date breaks `localeCompare`. Pin the coercion here.
		const ts = new Date(Date.UTC(2026, 4, 14, 18, 44, 22, 25));
		const row = {
			workspace_id: "73136050-d7a7-44a7-8e1d-fbb724bfba9b",
			audit_day: "2026-05-14",
			ts,
			decision_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
			principal_id: "alice",
			knowledge_base_id: "11111111-2222-3333-4444-555555555555",
			resource_id: "*",
			action: "list",
			decision: "filter",
			reason: "filter injected",
			compiled_filter_json: null,
		} as unknown as PolicyAuditRow;
		const record = policyAuditFromRow(row);
		expect(typeof record.ts).toBe("string");
		expect(record.ts).toBe("2026-05-14T18:44:22.025Z");
		// And the very thing that crashed in production must now work.
		expect(() => record.ts.localeCompare(record.ts)).not.toThrow();
	});

	test("principalFromRow coerces createdAt/updatedAt from Date to ISO string", () => {
		const created = new Date(Date.UTC(2026, 4, 14, 18, 0, 0));
		const updated = new Date(Date.UTC(2026, 4, 14, 18, 5, 0));
		const row = {
			workspace_id: "73136050-d7a7-44a7-8e1d-fbb724bfba9b",
			principal_id: "alice",
			label: "Alice",
			attributes: { role: "viewer" },
			created_at: created,
			updated_at: updated,
		} as unknown as PrincipalRow;
		const record = principalFromRow(row);
		expect(record.createdAt).toBe("2026-05-14T18:00:00.000Z");
		expect(record.updatedAt).toBe("2026-05-14T18:05:00.000Z");
	});
});
