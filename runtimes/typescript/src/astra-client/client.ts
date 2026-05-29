/**
 * Adapts `@datastax/astra-db-ts` to the {@link TablesBundle} shape used
 * by the astra control-plane store.
 *
 * Creates (idempotently) each of the four `wb_*` tables at init time,
 * then returns a bundle of typed accessors — the rest of the runtime
 * never touches the raw `Db` object.
 */

import {
	type CreateTableColumnDefinitions,
	DataAPIClient,
	DataAPIHttpError,
	DataAPIResponseError,
	type Db,
} from "@datastax/astra-db-ts";
import { RetryingAstraFetcher } from "../lib/astra-retrying-fetcher.js";
import { logger } from "../lib/logger.js";
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
	McpToolRow,
	MessageRow,
	PolicyAuditRow,
	PrincipalRow,
	RagDocumentByContentHashRow,
	RagDocumentByStatusRow,
	RagDocumentRow,
	RerankingServiceRow,
	WorkspaceRow,
} from "./row-types.js";
import {
	AGENTS_DEFINITION,
	AGENTS_TABLE,
	API_KEY_LOOKUP_DEFINITION,
	API_KEY_LOOKUP_TABLE,
	API_KEYS_DEFINITION,
	API_KEYS_TABLE,
	CHUNKING_SERVICES_DEFINITION,
	CHUNKING_SERVICES_TABLE,
	CONFIG_WORKSPACES_TABLE,
	CONVERSATIONS_DEFINITION,
	CONVERSATIONS_TABLE,
	EMBEDDING_SERVICES_DEFINITION,
	EMBEDDING_SERVICES_TABLE,
	JOBS_DEFINITION,
	JOBS_TABLE,
	KNOWLEDGE_BASES_DEFINITION,
	KNOWLEDGE_BASES_TABLE,
	KNOWLEDGE_FILTERS_DEFINITION,
	KNOWLEDGE_FILTERS_TABLE,
	LLM_SERVICES_DEFINITION,
	LLM_SERVICES_TABLE,
	MCP_SERVERS_DEFINITION,
	MCP_SERVERS_TABLE,
	MCP_TOOLS_DEFINITION,
	MCP_TOOLS_TABLE,
	MESSAGES_DEFINITION,
	MESSAGES_TABLE,
	POLICY_AUDIT_DEFINITION,
	POLICY_AUDIT_TABLE,
	PRINCIPALS_DEFINITION,
	PRINCIPALS_TABLE,
	RAG_DOCUMENTS_BY_HASH_DEFINITION,
	RAG_DOCUMENTS_BY_HASH_TABLE,
	RAG_DOCUMENTS_BY_STATUS_DEFINITION,
	RAG_DOCUMENTS_BY_STATUS_TABLE,
	RAG_DOCUMENTS_DEFINITION,
	RAG_DOCUMENTS_TABLE,
	RERANKING_SERVICES_DEFINITION,
	RERANKING_SERVICES_TABLE,
	WORKSPACES_DEFINITION,
	WORKSPACES_TABLE,
} from "./table-definitions.js";
import type { TablesBundle } from "./tables.js";

type ColumnDefinition = CreateTableColumnDefinitions[string];

interface AdditiveColumnMigration {
	readonly table: string;
	readonly column: string;
	readonly definition: ColumnDefinition;
}

const ADDITIVE_COLUMN_MIGRATIONS = [
	// Workspaces predate persisted UI URL/keyspace metadata in early
	// developer keyspaces.
	{
		table: WORKSPACES_TABLE,
		column: "url",
		definition: WORKSPACES_DEFINITION.columns.url,
	},
	{
		table: WORKSPACES_TABLE,
		column: "keyspace",
		definition: WORKSPACES_DEFINITION.columns.keyspace,
	},
	{
		table: WORKSPACES_TABLE,
		column: "rlac_enabled",
		definition: WORKSPACES_DEFINITION.columns.rlac_enabled,
	},
	// API-key scopes are additive; legacy keys default to full access
	// on read when the column is null/missing.
	{
		table: API_KEYS_TABLE,
		column: "scopes",
		definition: API_KEYS_DEFINITION.columns.scopes,
	},
	// Principal RBAC role is additive; legacy principals default to
	// `viewer` on read when the column is null/missing.
	{
		table: PRINCIPALS_TABLE,
		column: "role",
		definition: PRINCIPALS_DEFINITION.columns.role,
	},
	// Knowledge-base collection lifecycle + lexical config landed
	// after the first issue #98 control-plane table shape.
	{
		table: KNOWLEDGE_BASES_TABLE,
		column: "vector_collection",
		definition: KNOWLEDGE_BASES_DEFINITION.columns.vector_collection,
	},
	{
		table: KNOWLEDGE_BASES_TABLE,
		column: "owned",
		definition: KNOWLEDGE_BASES_DEFINITION.columns.owned,
	},
	{
		table: KNOWLEDGE_BASES_TABLE,
		column: "lexical_enabled",
		definition: KNOWLEDGE_BASES_DEFINITION.columns.lexical_enabled,
	},
	{
		table: KNOWLEDGE_BASES_TABLE,
		column: "lexical_analyzer",
		definition: KNOWLEDGE_BASES_DEFINITION.columns.lexical_analyzer,
	},
	{
		table: KNOWLEDGE_BASES_TABLE,
		column: "lexical_options",
		definition: KNOWLEDGE_BASES_DEFINITION.columns.lexical_options,
	},
	// Cross-replica job resume fields were added after the initial job
	// table. Rows written before them are read null-safe.
	{
		table: JOBS_TABLE,
		column: "leased_by",
		definition: JOBS_DEFINITION.columns.leased_by,
	},
	{
		table: JOBS_TABLE,
		column: "leased_at",
		definition: JOBS_DEFINITION.columns.leased_at,
	},
	{
		table: JOBS_TABLE,
		column: "ingest_input_json",
		definition: JOBS_DEFINITION.columns.ingest_input_json,
	},
	// Kind-agnostic resume snapshot (D2). Added additively alongside
	// the legacy `ingest_input_json` rather than renaming it, so
	// deployments with the old column keep resuming and pre-existing
	// rows stay readable.
	{
		table: JOBS_TABLE,
		column: "input_snapshot_json",
		definition: JOBS_DEFINITION.columns.input_snapshot_json,
	},
	// RLAC prototype additive columns. Existing deployments pick them
	// up on next boot; new deployments get them from the table DDL.
	{
		table: KNOWLEDGE_BASES_TABLE,
		column: "policy_dsl",
		definition: KNOWLEDGE_BASES_DEFINITION.columns.policy_dsl,
	},
	{
		table: KNOWLEDGE_BASES_TABLE,
		column: "policy_enabled",
		definition: KNOWLEDGE_BASES_DEFINITION.columns.policy_enabled,
	},
	{
		table: RAG_DOCUMENTS_TABLE,
		column: "visible_to",
		definition: RAG_DOCUMENTS_DEFINITION.columns.visible_to,
	},
	{
		table: RAG_DOCUMENTS_TABLE,
		column: "owner_principal_id",
		definition: RAG_DOCUMENTS_DEFINITION.columns.owner_principal_id,
	},
] as const satisfies readonly AdditiveColumnMigration[];

export interface AstraClientConfig {
	readonly endpoint: string;
	readonly token: string;
	readonly keyspace: string;
	readonly resume?: AstraResumeOptions;
}

/**
 * Backoff knobs for the boot-time "wait for Astra to resume" loop.
 * Defaults are sized to the typical Astra Serverless resume time
 * (~10–30s); test code can shrink them so retries don't gate CI.
 */
export interface AstraResumeOptions {
	readonly initialDelayMs?: number;
	readonly maxDelayMs?: number;
	readonly totalTimeoutMs?: number;
}

const DEFAULT_RESUME_INITIAL_DELAY_MS = 1000;
const DEFAULT_RESUME_MAX_DELAY_MS = 5000;
const DEFAULT_RESUME_TOTAL_TIMEOUT_MS = 60_000;

/**
 * Open a Data API connection, ensure the four `wb_*` tables exist,
 * and return a {@link TablesBundle} backed by real astra-db-ts tables.
 *
 * Idempotent — safe to call on every process start. Table creation
 * uses `ifNotExists: true` so existing schemas aren't touched.
 */
export async function openAstraClient(
	config: AstraClientConfig,
): Promise<TablesBundle> {
	// Custom `fetcher` wraps Astra's default-equivalent fetch path with
	// one retry on transient network errors (HTTP/2 GOAWAY, ECONNRESET,
	// undici timeouts). Without it, the steady drip of LB-driven
	// connection rotations on Astra's edge surfaces as 500s on
	// `/ingest/file` and other multi-call routes — see
	// `lib/astra-retrying-fetcher.ts` for the full rationale.
	const client = new DataAPIClient(config.token, {
		httpOptions: { client: "custom", fetcher: new RetryingAstraFetcher() },
	});
	const db = client.db(config.endpoint, { keyspace: config.keyspace });

	await waitForAstraResume(() => ensureTables(db), config.resume);

	return {
		workspaces: db.table<WorkspaceRow>(WORKSPACES_TABLE),
		jobs: db.table<JobRow>(JOBS_TABLE),
		apiKeys: db.table<ApiKeyRow>(API_KEYS_TABLE),
		apiKeyLookup: db.table<ApiKeyLookupRow>(API_KEY_LOOKUP_TABLE),
		// Knowledge-base schema (issue #98).
		configWorkspaces: db.table<ConfigWorkspaceRow>(CONFIG_WORKSPACES_TABLE),
		knowledgeBases: db.table<KnowledgeBaseRow>(KNOWLEDGE_BASES_TABLE),
		knowledgeFilters: db.table<KnowledgeFilterRow>(KNOWLEDGE_FILTERS_TABLE),
		chunkingServices: db.table<ChunkingServiceRow>(CHUNKING_SERVICES_TABLE),
		embeddingServices: db.table<EmbeddingServiceRow>(EMBEDDING_SERVICES_TABLE),
		rerankingServices: db.table<RerankingServiceRow>(RERANKING_SERVICES_TABLE),
		llmServices: db.table<LlmServiceRow>(LLM_SERVICES_TABLE),
		mcpTools: db.table<McpToolRow>(MCP_TOOLS_TABLE),
		mcpServers: db.table<McpServerRow>(MCP_SERVERS_TABLE),
		ragDocuments: db.table<RagDocumentRow>(RAG_DOCUMENTS_TABLE),
		ragDocumentsByStatus: db.table<RagDocumentByStatusRow>(
			RAG_DOCUMENTS_BY_STATUS_TABLE,
		),
		ragDocumentsByHash: db.table<RagDocumentByContentHashRow>(
			RAG_DOCUMENTS_BY_HASH_TABLE,
		),
		agents: db.table<AgentRow>(AGENTS_TABLE),
		conversations: db.table<ConversationRow>(CONVERSATIONS_TABLE),
		messages: db.table<MessageRow>(MESSAGES_TABLE),
		// RLAC prototype tables.
		principals: db.table<PrincipalRow>(PRINCIPALS_TABLE),
		policyAudit: db.table<PolicyAuditRow>(POLICY_AUDIT_TABLE),
	};
}

async function ensureTables(db: Db): Promise<void> {
	await Promise.all([
		db.createTable(WORKSPACES_TABLE, {
			definition: WORKSPACES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(JOBS_TABLE, {
			definition: JOBS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(API_KEYS_TABLE, {
			definition: API_KEYS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(API_KEY_LOOKUP_TABLE, {
			definition: API_KEY_LOOKUP_DEFINITION,
			ifNotExists: true,
		}),
		// WORKSPACES_TABLE is `wb_config_workspaces` (issue #98).
		db.createTable(KNOWLEDGE_BASES_TABLE, {
			definition: KNOWLEDGE_BASES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(KNOWLEDGE_FILTERS_TABLE, {
			definition: KNOWLEDGE_FILTERS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(CHUNKING_SERVICES_TABLE, {
			definition: CHUNKING_SERVICES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(EMBEDDING_SERVICES_TABLE, {
			definition: EMBEDDING_SERVICES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(RERANKING_SERVICES_TABLE, {
			definition: RERANKING_SERVICES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(LLM_SERVICES_TABLE, {
			definition: LLM_SERVICES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(MCP_TOOLS_TABLE, {
			definition: MCP_TOOLS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(MCP_SERVERS_TABLE, {
			definition: MCP_SERVERS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(RAG_DOCUMENTS_TABLE, {
			definition: RAG_DOCUMENTS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(RAG_DOCUMENTS_BY_STATUS_TABLE, {
			definition: RAG_DOCUMENTS_BY_STATUS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(RAG_DOCUMENTS_BY_HASH_TABLE, {
			definition: RAG_DOCUMENTS_BY_HASH_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(AGENTS_TABLE, {
			definition: AGENTS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(CONVERSATIONS_TABLE, {
			definition: CONVERSATIONS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(MESSAGES_TABLE, {
			definition: MESSAGES_DEFINITION,
			ifNotExists: true,
		}),
		// RLAC prototype.
		db.createTable(PRINCIPALS_TABLE, {
			definition: PRINCIPALS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(POLICY_AUDIT_TABLE, {
			definition: POLICY_AUDIT_DEFINITION,
			ifNotExists: true,
		}),
	]);

	// Additive column migrations on existing tables. `createTable
	// (ifNotExists)` is a no-op when the table already exists, so a
	// new column added to a definition does NOT land on a pre-existing
	// deployment without an explicit alter. Each migration here is
	// idempotent — safe to re-run on every boot.
	await ensureAdditiveColumns(db);
}

/**
 * Add non-key columns to existing deployments. Fresh deployments
 * already have them from the table definitions; the alters here are
 * no-op-on-duplicate handlers so the boot path is uniform.
 *
 * Data API's `alterTable.add` is a single-column command and fails
 * with `CANNOT_ADD_EXISTING_COLUMNS` (a `DataAPIResponseError`) when
 * the column is already present. We catch that one error and
 * continue; any other failure surfaces because it implies a real
 * schema problem (permissions, partition mismatch, etc.) the
 * operator should see at boot, not at first write.
 */
export async function ensureAdditiveColumns(
	db: Pick<Db, "table">,
): Promise<void> {
	for (const migration of ADDITIVE_COLUMN_MIGRATIONS) {
		await ensureAddedColumn(db, migration);
	}
}

async function ensureAddedColumn(
	db: Pick<Db, "table">,
	{ table, column, definition }: AdditiveColumnMigration,
): Promise<void> {
	try {
		await db.table<Record<string, unknown>>(table).alter({
			operation: {
				add: {
					columns: {
						[column]: definition,
					},
				},
			},
		});
	} catch (err) {
		if (isAlreadyHasColumnError(err)) return;
		throw err;
	}
}

/**
 * Wait for Astra DB to finish resuming if a paused Serverless DB is
 * woken up by the first request. Retries `op` on `HTTP 503 — Resuming
 * your database` with exponential backoff up to `totalTimeoutMs`.
 *
 * Non-resume errors propagate immediately so bad-endpoint or bad-token
 * failures still crash boot loudly. If the timeout elapses while the
 * DB is still resuming, the last resume error is rethrown — the
 * caller (top-level `main`) handles the exit.
 */
export async function waitForAstraResume<T>(
	op: () => Promise<T>,
	options: AstraResumeOptions | undefined = undefined,
): Promise<T> {
	const initialDelayMs =
		options?.initialDelayMs ?? DEFAULT_RESUME_INITIAL_DELAY_MS;
	const maxDelayMs = options?.maxDelayMs ?? DEFAULT_RESUME_MAX_DELAY_MS;
	const totalTimeoutMs =
		options?.totalTimeoutMs ?? DEFAULT_RESUME_TOTAL_TIMEOUT_MS;

	const startedAt = Date.now();
	let attempt = 0;
	let delayMs = initialDelayMs;

	while (true) {
		try {
			return await op();
		} catch (err) {
			if (!isAstraResumingError(err)) throw err;

			const elapsedMs = Date.now() - startedAt;
			const remainingMs = totalTimeoutMs - elapsedMs;
			if (remainingMs <= 0) throw err;

			attempt += 1;
			const sleepMs = Math.min(delayMs, remainingMs);
			logger.warn(
				{ attempt, delayMs: sleepMs, totalElapsedMs: elapsedMs },
				"Astra DB is resuming; retrying ensureTables",
			);
			await sleep(sleepMs);
			delayMs = Math.min(delayMs * 2, maxDelayMs);
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Classify the "DB is paused and resuming" envelope from Astra. We
 * match both the HTTP status AND the body signature so we don't
 * accidentally retry on unrelated 503s or 400s.
 *
 * Astra has been observed to use two wire shapes for the same
 * underlying condition, sometimes rotating mid-resume across LB
 * hand-offs:
 *
 *   - **Legacy**: `503` + body containing `"resuming your database"`.
 *   - **Hibernation**: `400` + body containing `"resuming from
 *     hibernation"`.
 *
 * Both are retried; non-matching 400s (real validation errors) and
 * non-matching 503s (gateway hiccups, maintenance) propagate.
 */
export function isAstraResumingError(err: unknown): boolean {
	if (!(err instanceof DataAPIHttpError)) return false;
	if (err.status !== 503 && err.status !== 400) return false;
	const body = (err.body ?? "").toLowerCase();
	return (
		body.includes("resuming your database") ||
		body.includes("resuming from hibernation")
	);
}

/**
 * Classify duplicate-column responses from additive table alters.
 *
 * Structured-code match first (stable contract); message fallback
 * second so a minor SDK-side phrasing change doesn't blow up boot.
 */
export function isAlreadyHasColumnError(err: unknown): boolean {
	if (err instanceof DataAPIResponseError) {
		for (const descriptor of err.errorDescriptors) {
			if (descriptor.errorCode === "CANNOT_ADD_EXISTING_COLUMNS") return true;
		}
	}
	const message = err instanceof Error ? err.message.toLowerCase() : "";
	return (
		message.includes("already exists") ||
		message.includes("already defined") ||
		message.includes("duplicate columns") ||
		message.includes("must be unique")
	);
}
