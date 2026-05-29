/**
 * Astra Data API tool provider (A4).
 *
 * Implements `astra:data_api` — a **scoped, read-only** Data API query
 * over the workspace's bound knowledge-base collections. The agent can
 * run two read shapes against a KB it can already see:
 *
 *   - `find` — a payload-filtered, positional read (sorted by
 *     `chunkIndex`, with limit/skip paging). Mirrors the public
 *     document-chunks route and the built-in `list_chunks` tool.
 *   - `vector_search` — server-side-embedded similarity search over the
 *     KB, reusing the Playground / `search-dispatch` path exactly like
 *     the built-in `search_kb` tool.
 *
 * The tool deliberately reuses the existing dispatch seam — `resolveKb`
 * to turn a KB id into a driver-ready descriptor, then `dispatchSearch`
 * / `driver.listRecords` — rather than reaching `astra-db-ts` directly.
 * That keeps it on the same audited, SSRF-guarded path as the rest of
 * the data plane and means it works against any backing driver that
 * implements the read methods.
 *
 * **Read-only contract.** Writes and DDL (insert / update / delete /
 * createCollection / dropCollection …) are refused with an `Error:`
 * string the model can self-correct on — never executed. The argument
 * schema only admits the two read operations; anything else (including
 * a model that smuggles a write verb into `operation`) is rejected
 * before any driver call.
 *
 * **Scope.** Only meaningful for `astra` / `hcd` workspaces — those are
 * the only kinds with a real Data API behind them. For every other kind
 * (`openrag`, `mock`) the provider contributes no tool at all, so the
 * id never appears in the candidate pool and can't be allow-listed onto
 * a non-Astra agent. The provider is rebuilt per tool resolution, so
 * returning `[]` for the non-Astra case keeps the registry clean.
 *
 * **Snapshot.** Every execution emits an {@link AstraQuerySnapshot}
 * (`vector_search` or `list_chunks`) through `deps.effects?.pushAstraQuery`,
 * mirroring `search_kb` / `list_chunks`, so the chat UI's "view client
 * code" affordance can render the equivalent runnable Data API call.
 *
 * Opt-in per agent: only active when `astra:data_api` is listed in the
 * agent's `toolIds`.
 */

import { z } from "@hono/zod-openapi";
import {
	CHUNK_INDEX_KEY,
	CHUNK_TEXT_KEY,
	DOCUMENT_SCOPE_KEY,
	KB_SCOPE_KEY,
} from "../../../ingest/payload-keys.js";
import { resolveKb } from "../../../routes/api-v1/kb-descriptor.js";
import { dispatchSearch } from "../../../routes/api-v1/search-dispatch.js";
import {
	buildListChunksSnapshot,
	buildVectorSearchSnapshot,
} from "../../../snapshots/types.js";
import type {
	AgentTool,
	AgentToolDeps,
	ToolProviderContext,
} from "../registry.js";

export const ASTRA_DATA_API_TOOL_ID = "astra:data_api";

/* Soft caps so a tool turn never blows up the prompt. Tunable. */
const MAX_LIMIT = 25;
const DEFAULT_FIND_LIMIT = 10;
const DEFAULT_TOPK = 5;
const MAX_TEXT_CHARS = 1500;

/**
 * Read-only operation discriminator. The *only* two values the tool
 * accepts. Anything outside this set — every write/DDL verb a model
 * might reach for — fails the schema and is refused before a driver is
 * touched.
 */
const READ_OPERATIONS = ["find", "vector_search"] as const;

/* --- find: payload-filtered positional read over a KB collection --- */

const findArgs = z
	.object({
		operation: z.literal("find"),
		knowledgeBaseId: z.string().uuid(),
		documentId: z.string().uuid().optional(),
		limit: z.number().int().positive().max(MAX_LIMIT).optional(),
		offset: z.number().int().nonnegative().optional(),
	})
	.strict();

/* --- vector_search: server-side-embedded similarity over a KB ------ */

const vectorSearchArgs = z
	.object({
		operation: z.literal("vector_search"),
		knowledgeBaseId: z.string().uuid(),
		query: z.string().min(1),
		topK: z.number().int().positive().max(MAX_LIMIT).optional(),
	})
	.strict();

/**
 * Discriminated union over the two read shapes. A discriminated union
 * (rather than a permissive object) means a payload naming any other
 * `operation` — `insert`, `update`, `delete`, `createCollection`, … —
 * fails to parse, which is exactly the write/DDL refusal we want.
 */
const dataApiArgs = z.discriminatedUnion("operation", [
	findArgs,
	vectorSearchArgs,
]);

const definition = {
	name: ASTRA_DATA_API_TOOL_ID,
	description:
		"Run a READ-ONLY Astra Data API query against one of this workspace's knowledge-base collections. Two operations: `find` (positional read — filter by `documentId`, paged by `limit`/`offset`, ordered by chunk index) and `vector_search` (semantic similarity over the KB for a natural-language `query`). Always pass `knowledgeBaseId` to scope the call to a collection you can see (use list_kbs first). This tool is read-only: it CANNOT insert, update, delete, or create/drop collections — such requests are refused.",
	parameters: {
		type: "object" as const,
		required: ["operation", "knowledgeBaseId"],
		properties: {
			operation: {
				type: "string" as const,
				enum: [...READ_OPERATIONS],
				description:
					"`find` for a positional/filtered read, `vector_search` for semantic similarity. Read operations only.",
			},
			knowledgeBaseId: {
				type: "string" as const,
				description:
					"UUID of the knowledge base whose collection to query. Required — the query is always scoped to one of this workspace's KBs.",
			},
			documentId: {
				type: "string" as const,
				description:
					"(`find` only) Scope the read to a single document's chunks. Omit to read across the whole KB collection.",
			},
			query: {
				type: "string" as const,
				description:
					"(`vector_search` only) Natural-language text to embed and search for.",
			},
			topK: {
				type: "integer" as const,
				minimum: 1,
				maximum: MAX_LIMIT,
				description: `(\`vector_search\` only) Max matches to return (default ${DEFAULT_TOPK}, hard cap ${MAX_LIMIT}).`,
			},
			limit: {
				type: "integer" as const,
				minimum: 1,
				maximum: MAX_LIMIT,
				description: `(\`find\` only) Max rows to return (default ${DEFAULT_FIND_LIMIT}, hard cap ${MAX_LIMIT}).`,
			},
			offset: {
				type: "integer" as const,
				minimum: 0,
				description:
					"(`find` only) Number of leading rows to skip — use to page beyond the first batch.",
			},
		},
		additionalProperties: false,
	},
};

/**
 * Build the `astra:data_api` tool. Closed over nothing from the
 * provider context — the workspace kind gate happens in
 * {@link astraTools}; execution resolves everything fresh from
 * {@link AgentToolDeps} so the tool behaves identically to the
 * built-ins.
 */
function makeAstraDataApiTool(): AgentTool {
	return {
		definition,
		async execute(rawArgs: unknown, deps: AgentToolDeps): Promise<string> {
			const parsed = dataApiArgs.safeParse(rawArgs);
			if (!parsed.success) {
				// A write/DDL operation lands here (it fails the read-only
				// discriminated union) alongside genuinely malformed args.
				// Surface a pointed refusal when the model named a known
				// write verb so it stops retrying the same mutation.
				return refusalOrValidationError(rawArgs, parsed.error);
			}

			const args = parsed.data;

			// Resolve the KB → driver-ready descriptor. A bad/foreign KB id
			// throws ControlPlaneNotFoundError; translate to an `Error:`
			// tool turn rather than letting it bubble out of the loop.
			let resolution: Awaited<ReturnType<typeof resolveKb>>;
			try {
				resolution = await resolveKb(
					deps.store,
					deps.workspaceId,
					args.knowledgeBaseId,
				);
			} catch (err) {
				deps.logger?.warn?.(
					{ err, workspaceId: deps.workspaceId, kb: args.knowledgeBaseId },
					"astra:data_api could not resolve knowledge base",
				);
				return `Error: knowledge base ${args.knowledgeBaseId} not found in this workspace.`;
			}

			const { workspace, knowledgeBase, descriptor } = resolution;
			// Defense-in-depth: the provider only hands this tool to
			// astra/hcd workspaces, but guard at execute time too in case
			// the workspace kind changed since resolution.
			if (workspace.kind !== "astra" && workspace.kind !== "hcd") {
				return `Error: the Astra Data API tool is only available for Astra/HCD workspaces (this workspace is '${workspace.kind}').`;
			}

			const envelope = {
				knowledgeBaseId: args.knowledgeBaseId,
				kbName: knowledgeBase.name,
				collection: descriptor.name,
				keyspace: workspace.keyspace,
			};

			if (args.operation === "vector_search") {
				return runVectorSearch(deps, resolution, envelope, args);
			}
			return runFind(deps, resolution, envelope, args);
		},
	};
}

async function runVectorSearch(
	deps: AgentToolDeps,
	resolution: Awaited<ReturnType<typeof resolveKb>>,
	envelope: {
		readonly knowledgeBaseId: string;
		readonly kbName: string;
		readonly collection: string;
		readonly keyspace: string | null;
	},
	args: z.infer<typeof vectorSearchArgs>,
): Promise<string> {
	const topK = args.topK ?? DEFAULT_TOPK;
	const driver = deps.drivers.for(resolution.workspace);

	let raw: Awaited<ReturnType<typeof dispatchSearch>>;
	try {
		raw = await dispatchSearch({
			ctx: resolution,
			driver,
			embedders: deps.embedders,
			body: { text: args.query, topK },
		});
	} catch (err) {
		deps.logger?.warn?.(
			{ err, workspaceId: deps.workspaceId, kb: args.knowledgeBaseId },
			"astra:data_api vector_search failed",
		);
		return `Error: vector search failed — ${safeMessage(err)}.`;
	}

	// Surface the runnable equivalent — a `find` with `$vectorize` sort
	// + top-K limit — so the chat UI can offer "view client code".
	deps.effects?.pushAstraQuery?.(
		buildVectorSearchSnapshot({ envelope, text: args.query, topK }),
	);

	const results = raw.map((hit) => {
		const payload = hit.payload ?? {};
		return {
			id: hit.id,
			score: hit.score,
			documentId:
				typeof payload[DOCUMENT_SCOPE_KEY] === "string"
					? (payload[DOCUMENT_SCOPE_KEY] as string)
					: null,
			content: truncate(chunkText(payload), MAX_TEXT_CHARS),
		};
	});

	if (results.length === 0) {
		return `No matches found in knowledge base ${envelope.kbName}.`;
	}
	return JSON.stringify({
		operation: "vector_search",
		knowledgeBaseId: args.knowledgeBaseId,
		collection: envelope.collection,
		returned: results.length,
		results,
	});
}

async function runFind(
	deps: AgentToolDeps,
	resolution: Awaited<ReturnType<typeof resolveKb>>,
	envelope: {
		readonly knowledgeBaseId: string;
		readonly kbName: string;
		readonly collection: string;
		readonly keyspace: string | null;
	},
	args: z.infer<typeof findArgs>,
): Promise<string> {
	const limit = args.limit ?? DEFAULT_FIND_LIMIT;
	const offset = args.offset ?? 0;
	const driver = deps.drivers.for(resolution.workspace);

	if (typeof driver.listRecords !== "function") {
		return `Error: driver for workspace kind '${resolution.workspace.kind}' doesn't support find/listRecords.`;
	}

	// Snapshot mirrors the built-in `list_chunks` shape — a `find`
	// filtered by document, ordered by chunkIndex, paged by limit/skip.
	deps.effects?.pushAstraQuery?.(
		buildListChunksSnapshot({
			envelope,
			documentId: args.documentId ?? "",
			limit,
			offset,
		}),
	);

	const filter: Record<string, unknown> = {
		[KB_SCOPE_KEY]: args.knowledgeBaseId,
	};
	if (args.documentId) filter[DOCUMENT_SCOPE_KEY] = args.documentId;

	let records: Awaited<ReturnType<NonNullable<typeof driver.listRecords>>>;
	try {
		// Over-fetch enough to honor offset + limit, then trim. Mirrors
		// what the public chunks route and `list_chunks` tool do.
		records = await driver.listRecords(
			{ workspace: resolution.workspace, descriptor: resolution.descriptor },
			{ filter, limit: offset + limit },
		);
	} catch (err) {
		deps.logger?.warn?.(
			{ err, workspaceId: deps.workspaceId, kb: args.knowledgeBaseId },
			"astra:data_api find failed",
		);
		return `Error: find failed — ${safeMessage(err)}.`;
	}

	const sorted = records
		.map((r) => ({
			id: r.id,
			documentId:
				typeof r.payload[DOCUMENT_SCOPE_KEY] === "string"
					? (r.payload[DOCUMENT_SCOPE_KEY] as string)
					: null,
			chunkIndex:
				typeof r.payload[CHUNK_INDEX_KEY] === "number"
					? (r.payload[CHUNK_INDEX_KEY] as number)
					: null,
			content: truncate(chunkText(r.payload), MAX_TEXT_CHARS),
		}))
		.sort((a, b) => {
			if (a.chunkIndex === null) return 1;
			if (b.chunkIndex === null) return -1;
			return a.chunkIndex - b.chunkIndex;
		});

	const window = sorted.slice(offset, offset + limit);
	if (window.length === 0) {
		return `No rows found in knowledge base ${envelope.kbName}${
			args.documentId ? ` for document ${args.documentId}` : ""
		}.`;
	}
	return JSON.stringify({
		operation: "find",
		knowledgeBaseId: args.knowledgeBaseId,
		collection: envelope.collection,
		...(args.documentId && { documentId: args.documentId }),
		offset,
		returned: window.length,
		rows: window,
	});
}

/**
 * Astra Data API tool provider. Contributes the single
 * `astra:data_api` tool — but only for `astra` / `hcd` workspaces. For
 * every other workspace kind it contributes nothing, so the tool id
 * stays out of the candidate pool and can't be allow-listed onto a
 * non-Astra agent.
 */
export async function astraTools(
	ctx: ToolProviderContext,
): Promise<readonly AgentTool[]> {
	const workspace = await ctx.store.getWorkspace(ctx.workspaceId);
	if (!workspace) return [];
	if (workspace.kind !== "astra" && workspace.kind !== "hcd") return [];
	return [makeAstraDataApiTool()];
}

/* ------------------------------ helpers ---------------------------- */

/** Write/DDL verbs a model might reach for. Used only to give a
 *  sharper refusal message than the generic schema error — the schema
 *  already rejects them. */
const WRITE_VERBS = [
	"insert",
	"insertone",
	"insertmany",
	"update",
	"updateone",
	"updatemany",
	"delete",
	"deleteone",
	"deletemany",
	"replace",
	"replaceone",
	"createcollection",
	"dropcollection",
	"create",
	"drop",
	"upsert",
];

/**
 * Turn a failed parse into a tool-turn string. When the rejected
 * payload named a recognizable write/DDL verb in `operation`, return an
 * explicit read-only refusal so the model stops retrying the mutation;
 * otherwise fall back to the generic validation message.
 */
function refusalOrValidationError(rawArgs: unknown, err: z.ZodError): string {
	const op =
		typeof rawArgs === "object" &&
		rawArgs !== null &&
		"operation" in rawArgs &&
		typeof (rawArgs as { operation: unknown }).operation === "string"
			? (rawArgs as { operation: string }).operation
			: null;
	if (op && WRITE_VERBS.includes(op.toLowerCase().replace(/[\s_-]/g, ""))) {
		return `Error: '${op}' is a write/DDL operation — the Astra Data API tool is read-only and only supports ${READ_OPERATIONS.join(" / ")}.`;
	}
	return formatZodError(err);
}

function chunkText(payload: Readonly<Record<string, unknown>>): string {
	if (typeof payload[CHUNK_TEXT_KEY] === "string") {
		return payload[CHUNK_TEXT_KEY] as string;
	}
	if (typeof payload.content === "string") return payload.content;
	if (typeof payload.text === "string") return payload.text;
	return "";
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}

function safeMessage(err: unknown): string {
	return err instanceof Error ? err.message : "unknown error";
}

function formatZodError(err: z.ZodError): string {
	const issues = err.issues
		.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
		.join("; ");
	return `Error: invalid arguments — ${issues}.`;
}
