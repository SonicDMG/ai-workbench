/**
 * Astra Data API tool provider (0.4.0, A4).
 *
 * Asserts the three contract points for `astra:data_api`:
 *   1. The tool is contributed ONLY for `astra` / `hcd` workspaces —
 *      `mock` / `openrag` get nothing, so the id can't be allow-listed
 *      onto a non-Astra agent.
 *   2. A read query (`vector_search` / `find`) returns results AND pushes
 *      the matching `AstraQuerySnapshot` through the effects sink so the
 *      chat UI's "view client code" affordance lights up.
 *   3. A write/DDL attempt is REFUSED with an `Error:` string and never
 *      reaches the driver.
 *
 * Backing store is the in-memory control plane seeded with an Astra-kind
 * workspace + embedding service + KB. The data plane is a small stub
 * `VectorStoreDriver` registered for the `astra` kind that implements
 * just `searchByText` + `listRecords` (the two read methods the tool
 * uses) and records its calls — so a refused write proves it never
 * touched a mutating method.
 */

import { describe, expect, test } from "vitest";
import type { AstraQuerySnapshot } from "../../../src/chat/retrieval.js";
import { ASTRA_DATA_API_TOOL_ID } from "../../../src/chat/tools/providers/astra.js";
import {
	type AgentToolDeps,
	resolveAgentToolset,
	type ToolEffectsSink,
	type ToolProviderContext,
} from "../../../src/chat/tools/registry.js";
import { MemoryControlPlaneStore } from "../../../src/control-plane/memory/store.js";
import type { WorkspaceKind } from "../../../src/control-plane/types.js";
import { VectorStoreDriverRegistry } from "../../../src/drivers/registry.js";
import type {
	ListRecordsRequest,
	SearchByTextRequest,
	SearchHit,
	StoredRecord,
	VectorStoreDriver,
	VectorStoreDriverContext,
} from "../../../src/drivers/vector-store.js";
import { EnvSecretProvider } from "../../../src/secrets/env.js";
import { SecretResolver } from "../../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../../helpers/embedder.js";

const DIM = 8;

/**
 * Stub Astra-kind driver. Implements only the two read methods the
 * tool reaches for; every write method throws so a leaked write would
 * blow up the test loudly rather than silently no-op. Tracks which
 * read methods ran so we can assert reads happened and writes didn't.
 */
class StubAstraDriver implements VectorStoreDriver {
	readonly seen: string[] = [];
	rows: StoredRecord[] = [];
	hits: SearchHit[] = [];

	async createCollection(): Promise<void> {
		throw new Error("write attempted: createCollection");
	}
	async dropCollection(): Promise<void> {
		throw new Error("write attempted: dropCollection");
	}
	async upsert(): Promise<{ upserted: number }> {
		throw new Error("write attempted: upsert");
	}
	async deleteRecord(): Promise<{ deleted: boolean }> {
		throw new Error("write attempted: deleteRecord");
	}
	async search(): Promise<readonly SearchHit[]> {
		this.seen.push("search");
		return this.hits;
	}
	async searchByText(
		_ctx: VectorStoreDriverContext,
		_req: SearchByTextRequest,
	): Promise<readonly SearchHit[]> {
		this.seen.push("searchByText");
		return this.hits;
	}
	async listRecords(
		_ctx: VectorStoreDriverContext,
		_req: ListRecordsRequest,
	): Promise<readonly StoredRecord[]> {
		this.seen.push("listRecords");
		return this.rows;
	}
}

interface Fixture {
	ctx: ToolProviderContext;
	deps: AgentToolDeps;
	driver: StubAstraDriver;
	knowledgeBaseId: string;
	documentId: string;
	snapshots: AstraQuerySnapshot[];
}

async function fixture(kind: WorkspaceKind): Promise<Fixture> {
	const store = new MemoryControlPlaneStore();
	const driver = new StubAstraDriver();
	// Register the stub under whatever kind the workspace will be; the
	// registry resolves by `workspace.kind`. For mock/openrag the tool
	// is never built so the driver is never consulted.
	const drivers = new VectorStoreDriverRegistry(
		new Map<WorkspaceKind, VectorStoreDriver>([[kind, driver]]),
	);
	const embedders = makeFakeEmbedderFactory();
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });

	const ws = await store.createWorkspace({
		name: "ws",
		kind,
		keyspace: "default_keyspace",
	});

	// Seed an embedding service + KB so resolveKb can synthesise a
	// descriptor for astra/hcd fixtures. Harmless for mock/openrag —
	// those never reach resolveKb because the tool isn't built.
	const embSvc = await store.createEmbeddingService(ws.uid, {
		name: "emb",
		provider: "fake",
		modelName: "fake",
		embeddingDimension: DIM,
	});
	const chunkSvc = await store.createChunkingService(ws.uid, {
		name: "chunk",
		engine: "langchain_ts",
	});
	const kb = await store.createKnowledgeBase(ws.uid, {
		name: "kb-one",
		chunkingServiceId: chunkSvc.chunkingServiceId,
		embeddingServiceId: embSvc.embeddingServiceId,
	});
	const doc = await store.createRagDocument(ws.uid, kb.knowledgeBaseId, {
		sourceFilename: "rows.csv",
		fileType: "text/csv",
	});

	const snapshots: AstraQuerySnapshot[] = [];
	const effects: ToolEffectsSink = {
		pushAstraQuery(s) {
			snapshots.push(s);
		},
	};

	return {
		ctx: {
			workspaceId: ws.uid,
			store,
			drivers,
			embedders,
			secrets,
			chatConfig: null,
		},
		deps: { workspaceId: ws.uid, store, drivers, embedders, effects },
		driver,
		knowledgeBaseId: kb.knowledgeBaseId,
		documentId: doc.documentId,
		snapshots,
	};
}

describe("astraTools — provider gate by workspace kind", () => {
	test("astra workspace exposes astra:data_api", async () => {
		const f = await fixture("astra");
		const ts = await resolveAgentToolset([ASTRA_DATA_API_TOOL_ID], f.ctx);
		expect(ts.tools.map((t) => t.definition.name)).toEqual([
			ASTRA_DATA_API_TOOL_ID,
		]);
		expect(ts.resolve(ASTRA_DATA_API_TOOL_ID)).not.toBeNull();
	});

	test("hcd workspace exposes astra:data_api", async () => {
		const f = await fixture("hcd");
		const ts = await resolveAgentToolset([ASTRA_DATA_API_TOOL_ID], f.ctx);
		expect(ts.tools.map((t) => t.definition.name)).toEqual([
			ASTRA_DATA_API_TOOL_ID,
		]);
	});

	test("mock workspace does NOT expose astra:data_api", async () => {
		const f = await fixture("mock");
		const ts = await resolveAgentToolset([ASTRA_DATA_API_TOOL_ID], f.ctx);
		expect(ts.tools).toEqual([]);
		expect(ts.resolve(ASTRA_DATA_API_TOOL_ID)).toBeNull();
	});

	test("openrag workspace does NOT expose astra:data_api", async () => {
		const f = await fixture("openrag");
		const ts = await resolveAgentToolset([ASTRA_DATA_API_TOOL_ID], f.ctx);
		expect(ts.tools).toEqual([]);
	});
});

describe("astra:data_api — read queries surface results + snapshot", () => {
	test("vector_search returns hits and pushes a vector_search snapshot", async () => {
		const f = await fixture("astra");
		f.driver.hits = [
			{
				id: `${f.documentId}:0`,
				score: 0.91,
				payload: { documentId: f.documentId, chunkText: "alpha row" },
			},
		];
		const ts = await resolveAgentToolset([ASTRA_DATA_API_TOOL_ID], f.ctx);
		const tool = ts.resolve(ASTRA_DATA_API_TOOL_ID);
		expect(tool).not.toBeNull();

		const out = await tool?.execute(
			{
				operation: "vector_search",
				knowledgeBaseId: f.knowledgeBaseId,
				query: "alpha",
				topK: 3,
			},
			f.deps,
		);

		const parsed = JSON.parse(out ?? "{}");
		expect(parsed.operation).toBe("vector_search");
		expect(parsed.results).toHaveLength(1);
		expect(parsed.results[0].content).toBe("alpha row");
		expect(parsed.results[0].documentId).toBe(f.documentId);

		// Read method ran; no write method was reachable (they throw).
		expect(f.driver.seen).toContain("searchByText");

		// Snapshot surfaced for the "view client code" affordance.
		expect(f.snapshots).toHaveLength(1);
		const snap = f.snapshots[0];
		expect(snap?.kind).toBe("vector_search");
		expect(snap?.knowledgeBaseId).toBe(f.knowledgeBaseId);
		expect(snap?.keyspace).toBe("default_keyspace");
		if (snap?.kind === "vector_search") {
			expect(snap.query).toEqual({ text: "alpha", topK: 3 });
		}
	});

	test("find returns rows (chunk-ordered) and pushes a list_chunks snapshot", async () => {
		const f = await fixture("astra");
		f.driver.rows = [
			{
				id: `${f.documentId}:1`,
				payload: {
					knowledgeBaseId: f.knowledgeBaseId,
					documentId: f.documentId,
					chunkIndex: 1,
					chunkText: "second",
				},
			},
			{
				id: `${f.documentId}:0`,
				payload: {
					knowledgeBaseId: f.knowledgeBaseId,
					documentId: f.documentId,
					chunkIndex: 0,
					chunkText: "first",
				},
			},
		];
		const ts = await resolveAgentToolset([ASTRA_DATA_API_TOOL_ID], f.ctx);
		const tool = ts.resolve(ASTRA_DATA_API_TOOL_ID);

		const out = await tool?.execute(
			{
				operation: "find",
				knowledgeBaseId: f.knowledgeBaseId,
				documentId: f.documentId,
				limit: 10,
			},
			f.deps,
		);

		const parsed = JSON.parse(out ?? "{}");
		expect(parsed.operation).toBe("find");
		expect(parsed.rows).toHaveLength(2);
		// Sorted by chunkIndex ascending even though the driver returned
		// them out of order.
		expect(parsed.rows.map((r: { content: string }) => r.content)).toEqual([
			"first",
			"second",
		]);

		expect(f.driver.seen).toContain("listRecords");
		expect(f.snapshots).toHaveLength(1);
		const snap = f.snapshots[0];
		expect(snap?.kind).toBe("list_chunks");
		if (snap?.kind === "list_chunks") {
			expect(snap.query.documentId).toBe(f.documentId);
			expect(snap.query.limit).toBe(10);
		}
	});

	test("an unknown knowledge base id is refused (no snapshot)", async () => {
		const f = await fixture("astra");
		const ts = await resolveAgentToolset([ASTRA_DATA_API_TOOL_ID], f.ctx);
		const tool = ts.resolve(ASTRA_DATA_API_TOOL_ID);
		const out = await tool?.execute(
			{
				operation: "vector_search",
				knowledgeBaseId: "11111111-2222-4333-8444-555555555555",
				query: "x",
			},
			f.deps,
		);
		expect(out).toMatch(/^Error:/);
		expect(out).toMatch(/not found/);
		expect(f.snapshots).toEqual([]);
	});
});

describe("astra:data_api — write/DDL refusal", () => {
	test.each([
		"insert",
		"insertMany",
		"update",
		"delete",
		"deleteMany",
		"createCollection",
		"dropCollection",
		"upsert",
	])("refuses operation '%s' without touching the driver", async (op) => {
		const f = await fixture("astra");
		const ts = await resolveAgentToolset([ASTRA_DATA_API_TOOL_ID], f.ctx);
		const tool = ts.resolve(ASTRA_DATA_API_TOOL_ID);

		const out = await tool?.execute(
			{ operation: op, knowledgeBaseId: f.knowledgeBaseId },
			f.deps,
		);

		expect(out).toMatch(/^Error:/);
		expect(out).toMatch(/read-only|write\/DDL/);
		// No driver method ran (reads would log to `seen`; writes throw).
		expect(f.driver.seen).toEqual([]);
		// And nothing surfaced to the UI.
		expect(f.snapshots).toEqual([]);
	});

	test("a write verb in `operation` yields a pointed read-only refusal", async () => {
		const f = await fixture("astra");
		const ts = await resolveAgentToolset([ASTRA_DATA_API_TOOL_ID], f.ctx);
		const tool = ts.resolve(ASTRA_DATA_API_TOOL_ID);
		const out = await tool?.execute(
			{ operation: "deleteMany", knowledgeBaseId: f.knowledgeBaseId },
			f.deps,
		);
		expect(out).toMatch(/read-only/);
		expect(out).toMatch(/find/);
		expect(out).toMatch(/vector_search/);
	});
});
