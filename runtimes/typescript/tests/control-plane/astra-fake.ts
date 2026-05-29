/**
 * In-memory fake of the {@link TablesBundle} shape, for exercising the
 * {@link AstraControlPlaneStore} without a real Astra endpoint.
 *
 * Implements only the subset of behavior our store depends on:
 *   - `insertOne` appends a row (no upsert semantics — we always check
 *     existence first in the real store, matching contract expectations).
 *   - `findOne` picks the first row whose fields exactly match the
 *     filter (supports equality-only filters, which is all we ever
 *     send).
 *   - `find` returns a cursor over all matching rows.
 *   - `updateOne` mutates the first matching row using `$set`.
 *   - `deleteOne` / `deleteMany` drop matching rows.
 *
 * Not a faithful Data API Tables implementation — good enough to let
 * every contract assertion pass. A real-Astra integration test will
 * live under a CI gate once creds are available.
 */

import type {
	SomeRow,
	TableFilter,
	TableUpdateFilter,
} from "@datastax/astra-db-ts";
import type {
	AgentRow,
	ApiKeyLookupRow,
	ApiKeyRow,
	ChunkingServiceRow,
	ConfigWorkspaceRow,
	ConversationRow,
	EmbeddingServiceRow,
	JobRow,
	KnowledgeBaseRow,
	KnowledgeFilterRow,
	LlmServiceRow,
	McpServerRow,
	MessageRow,
	PolicyAuditRow,
	PrincipalRow,
	RagDocumentByContentHashRow,
	RagDocumentByStatusRow,
	RagDocumentRow,
	RerankingServiceRow,
	WorkspaceRow,
} from "../../src/astra-client/row-types.js";
import type {
	Cursor,
	TableLike,
	TablesBundle,
} from "../../src/astra-client/tables.js";

function matches<Row extends SomeRow>(
	row: Row,
	filter: TableFilter<Row>,
): boolean {
	const f = filter as Record<string, unknown>;
	return Object.entries(f).every(
		([k, v]) => (row as Record<string, unknown>)[k] === v,
	);
}

class FakeTable<Row extends SomeRow> implements TableLike<Row> {
	private rows: Row[] = [];

	/**
	 * Schema constraints the fake enforces to mirror Astra's Data API
	 * rules:
	 *
	 *   - `deleteMany` requires every partition column to be pinned —
	 *     Astra rejects partition-spanning bulk deletes.
	 *   - `deleteOne` and `updateOne` require the **full** primary key
	 *     (partition + clustering). Astra's "fully specify the primary
	 *     key" error is exactly this case; a permissive fake makes
	 *     tests pass while production 500s.
	 *
	 * `partitionKey` lists partition columns only. `clusteringKey`
	 * lists the additional sort columns; `[...partitionKey,
	 * ...clusteringKey]` is the full PK enforced on deleteOne /
	 * updateOne. Tables with single-column PKs leave clusteringKey
	 * empty.
	 */
	constructor(
		private readonly partitionKey: readonly string[] = [],
		private readonly clusteringKey: readonly string[] = [],
	) {}

	private get primaryKey(): readonly string[] {
		return [...this.partitionKey, ...this.clusteringKey];
	}

	async insertOne(row: Row): Promise<unknown> {
		this.rows.push({ ...row });
		return { insertedId: row };
	}

	async findOne(filter: TableFilter<Row>): Promise<Row | null> {
		const hit = this.rows.find((r) => matches(r, filter));
		return hit ? { ...hit } : null;
	}

	find(filter: TableFilter<Row>): Cursor<Row> {
		const snapshot = this.rows
			.filter((r) => matches(r, filter))
			.map((r) => ({
				...r,
			}));
		return {
			async toArray(): Promise<Row[]> {
				return snapshot;
			},
		};
	}

	async updateOne(
		filter: TableFilter<Row>,
		update: TableUpdateFilter<Row>,
	): Promise<void> {
		this.assertFullPrimaryKey("updateOne", filter);
		const idx = this.rows.findIndex((r) => matches(r, filter));
		if (idx < 0) return;
		const set = (update as { $set?: Record<string, unknown> }).$set ?? {};
		const existing = this.rows[idx] as Row;
		this.rows[idx] = { ...existing, ...set } as Row;
	}

	async deleteOne(filter: TableFilter<Row>): Promise<void> {
		this.assertFullPrimaryKey("deleteOne", filter);
		const idx = this.rows.findIndex((r) => matches(r, filter));
		if (idx >= 0) this.rows.splice(idx, 1);
	}

	async deleteMany(filter: TableFilter<Row>): Promise<void> {
		const f = filter as Record<string, unknown>;
		const filterKeys = Object.keys(f);
		if (filterKeys.length > 0) {
			const missing = this.partitionKey.filter((k) => !(k in f));
			if (missing.length > 0) {
				throw new Error(
					`deleteMany filter is missing partition key column(s): ${missing.join(
						", ",
					)}`,
				);
			}
		}
		this.rows = this.rows.filter((r) => !matches(r, filter));
	}

	private assertFullPrimaryKey(
		op: "updateOne" | "deleteOne",
		filter: TableFilter<Row>,
	): void {
		const pk = this.primaryKey;
		if (pk.length === 0) return;
		const f = filter as Record<string, unknown>;
		const missing = pk.filter((k) => !(k in f));
		if (missing.length > 0) {
			throw new Error(
				`${op} filter is missing primary key column(s): ${missing.join(", ")}`,
			);
		}
	}
}

export function createFakeTablesBundle(): TablesBundle {
	return {
		workspaces: new FakeTable<WorkspaceRow>(["uid"]),
		jobs: new FakeTable<JobRow>(["workspace"], ["job_id"]),
		apiKeys: new FakeTable<ApiKeyRow>(["workspace"], ["key_id"]),
		apiKeyLookup: new FakeTable<ApiKeyLookupRow>(["prefix"]),
		// Knowledge-base schema (issue #98).
		configWorkspaces: new FakeTable<ConfigWorkspaceRow>(["uid"]),
		knowledgeBases: new FakeTable<KnowledgeBaseRow>(
			["workspace_id"],
			["knowledge_base_id"],
		),
		knowledgeFilters: new FakeTable<KnowledgeFilterRow>(
			["workspace_id", "knowledge_base_id"],
			["knowledge_filter_id"],
		),
		chunkingServices: new FakeTable<ChunkingServiceRow>(
			["workspace_id"],
			["chunking_service_id"],
		),
		embeddingServices: new FakeTable<EmbeddingServiceRow>(
			["workspace_id"],
			["embedding_service_id"],
		),
		rerankingServices: new FakeTable<RerankingServiceRow>(
			["workspace_id"],
			["reranking_service_id"],
		),
		llmServices: new FakeTable<LlmServiceRow>(
			["workspace_id"],
			["llm_service_id"],
		),
		mcpServers: new FakeTable<McpServerRow>(
			["workspace_id"],
			["mcp_server_id"],
		),
		ragDocuments: new FakeTable<RagDocumentRow>(
			["workspace_id", "knowledge_base_id"],
			["document_id"],
		),
		ragDocumentsByStatus: new FakeTable<RagDocumentByStatusRow>(
			["workspace_id", "knowledge_base_id", "status"],
			["document_id"],
		),
		ragDocumentsByHash: new FakeTable<RagDocumentByContentHashRow>(
			["content_hash"],
			["workspace_id", "knowledge_base_id", "document_id"],
		),
		agents: new FakeTable<AgentRow>(["workspace_id"], ["agent_id"]),
		conversations: new FakeTable<ConversationRow>(
			["workspace_id", "agent_id"],
			["created_at", "conversation_id"],
		),
		messages: new FakeTable<MessageRow>(
			["workspace_id", "conversation_id"],
			["message_ts"],
		),
		// RLAC prototype tables.
		principals: new FakeTable<PrincipalRow>(["workspace_id"], ["principal_id"]),
		policyAudit: new FakeTable<PolicyAuditRow>(
			["workspace_id", "audit_day"],
			["ts", "decision_id"],
		),
	};
}
