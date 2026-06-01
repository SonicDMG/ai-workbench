/**
 * Model Context Protocol server façade.
 *
 * Each request to `/api/v1/workspaces/{workspaceId}/mcp` constructs
 * a fresh {@link McpServer} and {@link WebStandardStreamableHTTPServerTransport}
 * pair scoped to that workspace, and hands the call off to the
 * MCP SDK. Stateless — no session state survives between requests.
 *
 * The tools exposed are deliberately a subset of the full HTTP API:
 *
 *   - `list_knowledge_bases`   read-only KB metadata
 *   - `list_agents`            read-only agent metadata for the workspace
 *   - `get_agent`              one agent's full configuration
 *   - `list_documents`         paginated documents in a KB
 *   - `search_kb`              vector / hybrid / rerank search
 *   - `list_chats`             agent-scoped conversation metadata
 *   - `list_chat_messages`     turn-by-turn message history
 *   - `ingest_text`            write — append a document to a KB.
 *                              Synchronous; runs through the same
 *                              dedup + chunk + embed + upsert pipeline
 *                              as the public REST `POST /ingest`
 *                              route, so MCP and REST ingests are
 *                              indistinguishable downstream. Disabled
 *                              when `ingestService` is null on the
 *                              server deps.
 *   - `delete_document`        write — remove a document and cascade
 *                              its chunks from the KB's vector
 *                              collection. Wraps the same
 *                              `cascadeDeleteRagDocument` helper the
 *                              REST `DELETE /documents/{id}` route
 *                              uses, so behavior is identical across
 *                              the two front doors. Co-gated with
 *                              `ingest_text` on `ingestService` —
 *                              both write tools are present or
 *                              absent together.
 *   - `create_knowledge_base`  write — provision a new KB bound to
 *                              existing chunking + embedding services.
 *                              Wraps the same `KnowledgeBaseService`
 *                              the REST `POST /knowledge-bases` route
 *                              uses, so MCP and REST create paths run
 *                              the same collection-provision and
 *                              rollback dance.
 *   - `delete_knowledge_base`  write — drop the underlying vector
 *                              collection (for owned KBs) and remove
 *                              the control-plane row. Idempotent —
 *                              re-deleting a missing KB returns a
 *                              `not_found` outcome instead of erroring.
 *                              Co-gated with `create_knowledge_base`
 *                              on `knowledgeBaseService`.
 *   - `chat_send`              optional, gated on `mcp.exposeChat`
 *                              + `chat` config; appends a user turn
 *                              to an agent's conversation, runs the
 *                              configured chat-completion model, and
 *                              returns the reply as a single text
 *                              block (streaming would require MCP
 *                              progress notifications which most
 *                              clients don't surface yet)
 *   - `run_agent`              optional, co-gated with `chat_send`;
 *                              one-call form that resolves (or
 *                              creates) a conversation bound to a
 *                              stored agent and runs a turn through
 *                              the same orchestration helper. Returns
 *                              the new/reused conversation id alongside
 *                              the assistant text so callers can
 *                              follow up without juggling chat
 *                              creation themselves.
 *
 * Auth is the same as every other `/api/v1/workspaces/*` route: the
 * app-level workspace authz wrapper runs before this handler, so a
 * scoped API key for workspace A cannot call MCP tools against
 * workspace B even if they have the URL.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { ResolvedPrincipal } from "../auth/types.js";
import type { ChatService } from "../chat/types.js";
import type { ChatConfig } from "../config/schema.js";
import { ControlPlaneNotFoundError } from "../control-plane/errors.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import { CHUNK_TEXT_KEY } from "../ingest/payload-keys.js";
import { ApiError } from "../lib/errors.js";
import { resolveKb } from "../routes/api-v1/kb-descriptor.js";
import { dispatchSearch } from "../routes/api-v1/search-dispatch.js";
import { isUserVisibleMessage } from "../routes/api-v1/serdes/index.js";
import { cascadeDeleteRagDocument } from "../services/document-cascade.js";
import type { IngestService } from "../services/ingest-service.js";
import type { KnowledgeBaseService } from "../services/knowledge-base-service.js";
import { VERSION } from "../version.js";
import { runAgentTurn } from "./run-agent.js";

/**
 * Refuse a write-tool invocation when the calling subject doesn't
 * carry the required scope. Returns an MCP tool error envelope the
 * caller can return directly from its handler; returns `null` when
 * the gate passes (so the handler proceeds normally).
 *
 * `null` `subjectScopes` means "no scope gate applies" — used for
 * anonymous (dev mode) and OIDC / bootstrap callers — and always
 * passes. A concrete array (including `[]`) is enforced.
 *
 * The deny envelope keeps the same shape MCP clients already handle
 * for tool failures (`isError: true` + structured `text` block) so a
 * read-only key trying to write surfaces in LangGraph / CrewAI / etc.
 * as a normal tool error, not a transport-level 403. The route layer
 * still emits an `mcp.invoke` audit event with `outcome: "denied"`
 * via the `onToolInvoke` hook.
 */
/**
 * Classify the MCP tool-handler result for audit purposes. The SDK's
 * `{ isError, content }` shape is the contract; we look inside the
 * text body for the `scope_required` marker {@link denyIfMissingScope}
 * stamps so a denial reads as `outcome: "denied"` in the audit log
 * (otherwise it would look like a generic `failure`).
 */
function classifyToolResult(result: unknown): "success" | "failure" | "denied" {
	if (!result || typeof result !== "object") return "success";
	const obj = result as { isError?: unknown };
	if (obj.isError !== true) return "success";
	return extractDenyReason(result) !== null ? "denied" : "failure";
}

/**
 * Extract the deny reason from a tool result, if present. Returns
 * `null` when the result is not a structured denial. Matches the
 * shape produced by {@link denyIfMissingScope}: a single `text`
 * content block whose JSON body carries `code: "scope_required"`.
 */
function extractDenyReason(result: unknown): string | null {
	if (!result || typeof result !== "object") return null;
	const obj = result as {
		content?: ReadonlyArray<{ type?: string; text?: string }>;
	};
	const first = obj.content?.[0];
	if (first?.type !== "text" || !first.text) return null;
	try {
		const parsed = JSON.parse(first.text);
		if (
			parsed &&
			typeof parsed === "object" &&
			parsed.code === "scope_required" &&
			typeof parsed.required === "string"
		) {
			return `scope '${parsed.required}' required`;
		}
	} catch {
		// Body wasn't JSON — not a denial we produced; let the caller
		// fall back to the generic failure path.
	}
	return null;
}

function denyIfMissingScope(
	subjectScopes: readonly string[] | null,
	required: string,
	toolName: string,
): {
	isError: true;
	content: Array<{ type: "text"; text: string }>;
} | null {
	if (subjectScopes === null) return null;
	if (subjectScopes.includes(required)) return null;
	return {
		isError: true,
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(
					{
						outcome: "denied",
						code: "scope_required",
						required,
						subjectScopes: [...subjectScopes],
						message: `the '${toolName}' tool requires the '${required}' scope; the calling API key has [${subjectScopes.join(", ") || "<empty>"}]. Mint a key with the '${required}' scope to enable this tool.`,
					},
					null,
					2,
				),
			},
		],
	};
}

export interface McpServerDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly chatService: ChatService | null;
	readonly chatConfig: ChatConfig | null;
	readonly exposeChat: boolean;
	/**
	 * Optional ingest service. When supplied, the MCP server registers
	 * the `ingest_text` write tool so external agents can put new
	 * material into a KB without leaving the protocol. Constructed once
	 * by `app.ts` and shared with the REST ingest routes — same dedup,
	 * name-conflict, and chunk pipeline.
	 *
	 * Null disables the tool (older runtimes / fixtures that don't wire
	 * an ingest service still load the read tools cleanly). The wire
	 * footprint is identical to the public REST `POST /ingest` body.
	 */
	readonly ingestService: IngestService | null;
	/**
	 * Optional knowledge-base service. When supplied, the MCP server
	 * registers the `create_knowledge_base` and `delete_knowledge_base`
	 * write tools. Same instance as the REST `/knowledge-bases` route
	 * uses, so MCP and REST KB lifecycle calls run the same
	 * collection-provision and rollback dance.
	 *
	 * Null disables both tools (older runtimes / fixtures that don't
	 * wire the service still load the read tools cleanly).
	 */
	readonly knowledgeBaseService: KnowledgeBaseService | null;
	/**
	 * Privilege tiers the caller carries, projected from the request's
	 * {@link AuthContext}. Used by the write tools (`ingest_text`,
	 * `delete_document`) to refuse calls from a `read`-only key with a
	 * structured tool error instead of running the mutation.
	 *
	 * Semantics match {@link assertScope} in `auth/authz.ts`:
	 *
	 *   - `null`  — no scope gate applies. Used for anonymous (dev mode)
	 *               and unscoped subjects (OIDC / bootstrap). Write
	 *               tools run as before.
	 *   - `[]`    — concrete empty set. Write tools refuse.
	 *   - `["read", "write"]` — a key that can do both. Write tools run.
	 *   - `["read"]` — a read-only key. Write tools refuse.
	 *
	 * Read tools (`search_kb`, `list_*`) deliberately do not check —
	 * any authenticated caller that reached the MCP route already
	 * passed the workspace-scope gate, which is the read floor today.
	 */
	readonly subjectScopes: readonly string[] | null;
	/**
	 * The caller's resolved RLAC principal (or null). Threaded into the
	 * `run_agent` / `chat_send` grounding retrieval so the MCP chat tools
	 * honor the workspace's row-level access policy — an external agent
	 * can't surface documents its key's principal can't see. Optional so
	 * older fixtures that omit it still load; absent ⇒ null (no principal).
	 */
	readonly principal?: ResolvedPrincipal | null;
	/**
	 * Optional hook fired around every tool invocation. Used by the
	 * route layer to emit `mcp.invoke` audit events without coupling
	 * the MCP server to the audit module — argument payloads are not
	 * passed in (the audit envelope deliberately omits them so secret
	 * material can never end up in the audit log).
	 */
	readonly onToolInvoke?: (info: McpToolInvocation) => void;
}

export interface McpToolInvocation {
	readonly toolName: string;
	/**
	 * `success`  — handler returned normally without `isError`.
	 * `failure`  — handler threw, OR returned `isError: true` with
	 *              some other failure reason (e.g. name_conflict).
	 * `denied`   — handler returned an authorization-shaped failure
	 *              (currently: missing `write` scope on a write tool).
	 *              Distinguished from `failure` so audit consumers can
	 *              alert on bursts of denied calls without parsing
	 *              tool-specific reasons.
	 */
	readonly outcome: "success" | "failure" | "denied";
	readonly reason?: string;
}

export interface McpHandleRequestArgs {
	readonly workspaceId: string;
	readonly request: Request;
	readonly deps: McpServerDeps;
}

/**
 * Run a single MCP request to completion. The transport handles
 * `initialize`, `tools/list`, `tools/call`, etc. — we just register
 * the tools and let the SDK route.
 *
 * Cleanup lifecycle: `transport.handleRequest()` returns the
 * `Response(readable, …)` shell **synchronously** while the SDK
 * still has to async-process the message and pipe the JSON-RPC
 * reply into the stream via `transport.send()`. A `finally` block
 * around `handleRequest` would call `transport.close()` (which
 * closes every open stream controller) before the SDK had a chance
 * to write the response — yielding `Content-Length: 0` on the
 * wire. Instead, we wrap the body in a TransformStream and run
 * cleanup from its `flush` / `cancel` hooks, which fire after the
 * SDK has finished sending or the client has disconnected.
 *
 * For non-streaming responses (e.g. JSON-RPC error envelopes that
 * the SDK returns directly), we still need to close the transport
 * — those Responses have a non-stream body and the wrapping is a
 * no-op, so we close on the next microtask.
 */
export async function handleMcpRequest(
	args: McpHandleRequestArgs,
): Promise<Response> {
	const server = buildMcpServer(args.workspaceId, args.deps);
	const transport = new WebStandardStreamableHTTPServerTransport({
		// Stateless — every request is a fresh server instance, no
		// per-client session ID to track.
		sessionIdGenerator: undefined,
	});
	await server.connect(transport);

	const cleanup = async (): Promise<void> => {
		await transport.close().catch(() => {});
		await server.close().catch(() => {});
	};

	let response: Response;
	try {
		response = await transport.handleRequest(args.request);
	} catch (error) {
		await cleanup();
		throw error;
	}

	// No body to drain — close immediately on the microtask queue so
	// the empty Response is delivered first, then the transport is
	// torn down.
	if (!response.body) {
		queueMicrotask(() => {
			void cleanup();
		});
		return response;
	}

	// Body is a stream (SSE or JSON written through a controller).
	// Pipe through a passthrough; cleanup runs when the stream
	// finishes naturally OR when the client cancels.
	const passthrough = new TransformStream({
		flush() {
			void cleanup();
		},
		// `cancel` runs when the consumer (Hono → Node adapter →
		// network) tears down the pipe early — e.g. client disconnect.
		// The TransformStream spec calls `cancel` on the writable side
		// in that case; mirror it on the readable side.
	});
	response.body.pipeTo(passthrough.writable).catch(() => {
		// pipeTo rejects on cancel; cleanup is still required.
		void cleanup();
	});

	return new Response(passthrough.readable, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

/**
 * Construct (but don't connect) the MCP server for a workspace.
 * Exported so tests can drive it through an `InMemoryTransport`
 * without going through HTTP.
 */
export function buildMcpServer(
	workspaceId: string,
	deps: McpServerDeps,
): McpServer {
	const server = new McpServer(
		{ name: `ai-workbench:${workspaceId}`, version: VERSION },
		{ capabilities: { tools: {}, resources: {} } },
	);

	// Audit-wrap registerTool once so every handler below fires the
	// optional `onToolInvoke` hook on success / failure / denied
	// without each call site having to remember. Denials are
	// distinguished from generic failures by the `code: "scope_required"`
	// marker {@link denyIfMissingScope} stamps into the text body —
	// keeps the wrap free of any tool-specific knowledge.
	const onInvoke = deps.onToolInvoke;
	if (onInvoke) {
		const original = server.registerTool.bind(server);
		// biome-ignore lint/suspicious/noExplicitAny: variadic SDK signature
		server.registerTool = ((name: string, config: any, handler: any) => {
			// biome-ignore lint/suspicious/noExplicitAny: SDK passes through
			const wrapped = async (...args: any[]) => {
				try {
					const result = await handler(...args);
					const outcome = classifyToolResult(result);
					onInvoke({
						toolName: name,
						outcome,
						...(outcome !== "success"
							? { reason: extractDenyReason(result) ?? "tool returned isError" }
							: {}),
					});
					return result;
				} catch (err) {
					const reason = err instanceof Error ? err.message : String(err);
					onInvoke({ toolName: name, outcome: "failure", reason });
					throw err;
				}
			};
			return original(name, config, wrapped);
			// biome-ignore lint/suspicious/noExplicitAny: type-erased wrapper
		}) as any;
	}

	server.registerTool(
		"list_knowledge_bases",
		{
			title: "List knowledge bases",
			description:
				"List the workspace's knowledge bases. Returns a JSON array of KB summaries (id, name, status, language, document counts implied by listing /documents per KB).",
			inputSchema: {},
		},
		async () => {
			const rows = await deps.store.listKnowledgeBases(workspaceId);
			const summary = rows.map((kb) => ({
				knowledgeBaseId: kb.knowledgeBaseId,
				name: kb.name,
				description: kb.description,
				status: kb.status,
				language: kb.language,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	server.registerTool(
		"list_agents",
		{
			title: "List agents in this workspace",
			description:
				"Enumerate the workspace's agents. Returns each agent's id, name, description, KBs the agent grounds on, and bound LLM service id (or null when the runtime-level chat config is used). Pair with `list_chats` to discover ongoing conversations for an agent and `list_chat_messages` to replay one.",
			inputSchema: {},
		},
		async () => {
			const rows = await deps.store.listAgents(workspaceId);
			const summary = rows.map((a) => ({
				agentId: a.agentId,
				name: a.name,
				description: a.description,
				knowledgeBaseIds: [...a.knowledgeBaseIds],
				llmServiceId: a.llmServiceId,
				rerankEnabled: a.rerankEnabled,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	server.registerTool(
		"get_agent",
		{
			title: "Get a single agent's configuration",
			description:
				"Return the full configuration of one agent — system prompt, user prompt, tool ids, KBs, and reranking overrides. Use this when an MCP client needs to render or audit an agent's setup before invoking it via `chat_send`.",
			inputSchema: {
				agentId: z.string().uuid(),
			},
		},
		async ({ agentId }) => {
			const row = await deps.store.getAgent(workspaceId, agentId);
			if (!row) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									outcome: "not_found",
									agentId,
									message: `No agent ${agentId} in this workspace.`,
								},
								null,
								2,
							),
						},
					],
				};
			}
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								agentId: row.agentId,
								name: row.name,
								description: row.description,
								systemPrompt: row.systemPrompt,
								userPrompt: row.userPrompt,
								toolIds: [...row.toolIds],
								knowledgeBaseIds: [...row.knowledgeBaseIds],
								llmServiceId: row.llmServiceId,
								rerankEnabled: row.rerankEnabled,
								rerankingServiceId: row.rerankingServiceId,
								rerankMaxResults: row.rerankMaxResults,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerTool(
		"list_documents",
		{
			title: "List documents in a knowledge base",
			description:
				"Paginated document metadata for a single knowledge base. Use this to discover which sources an agent can ground on. Returns id, source filename, status, content hash, and chunk count.",
			inputSchema: {
				knowledgeBaseId: z.string().uuid(),
				limit: z.number().int().positive().max(200).optional(),
			},
		},
		async ({ knowledgeBaseId, limit }) => {
			const all = await deps.store.listRagDocuments(
				workspaceId,
				knowledgeBaseId,
			);
			const slice = limit ? all.slice(0, limit) : [...all];
			const summary = slice.map((d) => ({
				documentId: d.documentId,
				sourceFilename: d.sourceFilename,
				status: d.status,
				chunkTotal: d.chunkTotal,
				contentHash: d.contentHash,
				ingestedAt: d.ingestedAt,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	server.registerTool(
		"search_kb",
		{
			title: "Search a knowledge base",
			description:
				"Run vector / hybrid / rerank search against a single knowledge base. Returns top-K hits with chunk id, score, document id, and chunk text. Use the same KB id from `list_knowledge_bases`. Provide `text` (most common) or a precomputed `vector`. Hybrid + rerank flags are optional and follow the descriptor's defaults when omitted.",
			inputSchema: {
				knowledgeBaseId: z.string().uuid(),
				text: z.string().min(1).optional(),
				vector: z.array(z.number()).optional(),
				topK: z.number().int().positive().max(64).optional(),
				hybrid: z.boolean().optional(),
				rerank: z.boolean().optional(),
			},
		},
		async ({ knowledgeBaseId, text, vector, topK, hybrid, rerank }) => {
			if (!text && !vector) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: "Either `text` or `vector` must be supplied.",
						},
					],
				};
			}
			const ctx = await resolveKb(deps.store, workspaceId, knowledgeBaseId);
			const driver = deps.drivers.for(ctx.workspace);
			const hits = await dispatchSearch({
				ctx,
				driver,
				embedders: deps.embedders,
				body: { text, vector, topK, hybrid, rerank },
			});
			const summary = hits.map((h) => {
				const reservedText = h.payload?.[CHUNK_TEXT_KEY];
				return {
					chunkId: h.id,
					score: h.score,
					documentId:
						typeof h.payload?.documentId === "string"
							? h.payload.documentId
							: null,
					content:
						typeof reservedText === "string"
							? reservedText
							: typeof h.payload?.content === "string"
								? h.payload.content
								: typeof h.payload?.text === "string"
									? h.payload.text
									: null,
				};
			});
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	server.registerTool(
		"list_chats",
		{
			title: "List chats for an agent",
			description:
				"List the conversations belonging to an agent in the workspace. Use the agentId returned by `list_agents` (or the value returned when the agent was created). Useful when an external client wants to read or audit prior conversations before adding to them.",
			inputSchema: {
				agentId: z.string().uuid(),
			},
		},
		async ({ agentId }) => {
			const rows = await deps.store.listConversations(workspaceId, agentId);
			const summary = rows.map((c) => ({
				chatId: c.conversationId,
				agentId: c.agentId,
				title: c.title,
				knowledgeBaseIds: c.knowledgeBaseIds,
				createdAt: c.createdAt,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	server.registerTool(
		"list_chat_messages",
		{
			title: "List chat messages",
			description:
				"Oldest-first message history for one conversation. Returns role, content, timestamp, and (for assistant turns) RAG provenance metadata.",
			inputSchema: {
				chatId: z.string().uuid(),
			},
		},
		async ({ chatId }) => {
			const rows = await deps.store.listChatMessages(workspaceId, chatId);
			// Hide internal scaffolding turns (tool results + the model's
			// pre-tool-call placeholders) — same filter as the public
			// `/messages` HTTP route.
			const summary = rows.filter(isUserVisibleMessage).map((m) => ({
				messageId: m.messageId,
				role: m.role,
				content: m.content,
				messageTs: m.messageTs,
				metadata: m.metadata,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	if (deps.ingestService) {
		registerIngestTextTool(
			server,
			workspaceId,
			deps.ingestService,
			deps.subjectScopes,
		);
		registerDeleteDocumentTool(server, workspaceId, deps);
	}

	if (deps.knowledgeBaseService) {
		registerCreateKnowledgeBaseTool(
			server,
			workspaceId,
			deps.knowledgeBaseService,
			deps.subjectScopes,
		);
		registerDeleteKnowledgeBaseTool(
			server,
			workspaceId,
			deps.knowledgeBaseService,
			deps.subjectScopes,
		);
	}

	if (deps.exposeChat && deps.chatService && deps.chatConfig) {
		const chatDeps: ChatToolDeps = {
			...deps,
			chatService: deps.chatService,
			chatConfig: deps.chatConfig,
		};
		registerChatTool(server, workspaceId, chatDeps);
		registerRunAgentTool(server, workspaceId, chatDeps);
	}

	return server;
}

/**
 * Wire `ingest_text` onto the MCP server. Kept as a free function so
 * the read tools and the write tool register through the same
 * `server.registerTool` audit wrapper but their bodies stay in
 * different parts of the file — write semantics (dedup, name
 * collisions, sync-only restriction) are non-trivial enough to
 * deserve their own block.
 *
 * Three outcomes mirror the REST route's `IngestOutcome` discriminant:
 *
 *   - **completed** — new document created and chunks upserted; the
 *     tool returns the document id, chunk count, and content hash.
 *   - **duplicate** — content-hash matches an existing document in
 *     this KB; the pipeline did NOT run and the tool returns the
 *     existing document's id with `outcome: "duplicate"`.
 *   - **name_conflict** — the source filename matches a different
 *     document. The tool returns `isError: true` and tells the caller
 *     to retry with `overwriteOnNameConflict: true` or pick a fresh
 *     filename; the pipeline did not run.
 *
 * Always synchronous from the MCP caller's POV — `async: false` is
 * passed through, so the JSON-RPC reply contains the final outcome.
 * Async ingest stays a REST-only path because MCP clients usually
 * inline tool calls into agent loops where the model needs the result
 * before continuing.
 */
function registerIngestTextTool(
	server: McpServer,
	workspaceId: string,
	ingestService: IngestService,
	subjectScopes: readonly string[] | null,
): void {
	server.registerTool(
		"ingest_text",
		{
			title: "Ingest plain text into a knowledge base",
			description:
				"Append a new document to a knowledge base by passing raw text. Runs the same dedup + chunk + embed + upsert pipeline as the REST `POST /ingest` route. Use this to let an agent record material it has just gathered (notes, transcripts, summaries) without leaving the MCP session. Returns the resulting documentId + chunk count, or signals duplicate / name_conflict when the pipeline short-circuits. **Requires the `write` scope on the calling key.**",
			inputSchema: {
				knowledgeBaseId: z.string().uuid(),
				text: z.string().min(1),
				sourceFilename: z.string().min(1).optional(),
				sourceDocId: z.string().min(1).optional(),
				metadata: z.record(z.string(), z.string()).optional(),
				overwriteOnNameConflict: z.boolean().optional(),
			},
		},
		async ({
			knowledgeBaseId,
			text,
			sourceFilename,
			sourceDocId,
			metadata,
			overwriteOnNameConflict,
		}) => {
			const denial = denyIfMissingScope(subjectScopes, "write", "ingest_text");
			if (denial) return denial;
			// IngestService.ingest takes the wire `KbIngestRequest`
			// shape. We forward what MCP gave us and let the service do
			// its own hash + collision pre-checks; no duplication of
			// dedup logic at this layer.
			const outcome = await ingestService.ingest(
				workspaceId,
				knowledgeBaseId,
				{
					text,
					sourceFilename,
					sourceDocId,
					metadata,
					overwriteOnNameConflict,
				},
				{ async: false },
			);

			if (outcome.kind === "name_conflict") {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									outcome: "name_conflict",
									documentId: outcome.document.documentId,
									sourceFilename: outcome.document.sourceFilename,
									message:
										"A different document with this filename already exists. Retry with `overwriteOnNameConflict: true` to replace it, or pick a new filename.",
								},
								null,
								2,
							),
						},
					],
				};
			}

			if (outcome.kind === "duplicate") {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									outcome: "duplicate",
									documentId: outcome.document.documentId,
									sourceFilename: outcome.document.sourceFilename,
									contentHash: outcome.document.contentHash,
									message:
										"Identical content already ingested; the existing document was returned without re-running the pipeline.",
								},
								null,
								2,
							),
						},
					],
				};
			}

			// The completed branch carries the new document and the
			// chunk count from the pipeline run. The pipeline shape is
			// the same for sync MCP and async REST; we just don't
			// surface `job` / `astraQueries` here because they are
			// REST-flow affordances (job polling, code-view previews)
			// that don't apply when the call returns inline. The
			// explicit narrow lets the compiler eliminate the "queued"
			// branch, which can't happen here because we passed
			// `async: false`.
			if (outcome.kind !== "completed") {
				throw new Error(
					`unexpected ingest outcome '${outcome.kind}' from sync MCP path`,
				);
			}
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								outcome: "completed",
								documentId: outcome.document.documentId,
								sourceFilename: outcome.document.sourceFilename,
								contentHash: outcome.document.contentHash,
								chunks: outcome.chunks,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}

/**
 * Wire `delete_document` onto the MCP server. Mirrors the REST hard-
 * delete (`DELETE /workspaces/{w}/knowledge-bases/{kb}/documents/{d}`)
 * by going through the same `cascadeDeleteRagDocument` helper — the
 * vector chunks come down first, then the control-plane row.
 *
 * Outcome envelope:
 *
 *   - **deleted**  — the row existed and is gone; returns
 *                    `documentId` and `chunksDropped` (or `null` when
 *                    the driver doesn't support chunk cleanup).
 *   - **not_found** — no row matched the id. Returned as a non-error
 *                    text content so an agent that ran a speculative
 *                    delete can see "this was already gone" without
 *                    branching on `isError`. A racing tab that won
 *                    the delete first is the common cause.
 *
 * Co-gated with `ingest_text` on `McpServerDeps.ingestService`. The
 * gate is logical, not technical — `cascadeDeleteRagDocument` only
 * needs `store` + `drivers` which are always there — but treating
 * the two write tools as a single feature keeps test surfaces aligned
 * and signals that "write surface is wired" through one flag.
 */
function registerDeleteDocumentTool(
	server: McpServer,
	workspaceId: string,
	deps: McpServerDeps,
): void {
	server.registerTool(
		"delete_document",
		{
			title: "Delete a document from a knowledge base",
			description:
				'Remove a document and cascade its chunks from the KB\'s vector collection. Idempotent — re-deleting a missing document returns `outcome: "not_found"` rather than erroring, so an agent can run speculative deletes without branching. Wraps the same cascade helper the REST `DELETE /documents/{id}` route uses, so behavior is identical across the two front doors. **Requires the `write` scope on the calling key.**',
			inputSchema: {
				knowledgeBaseId: z.string().uuid(),
				documentId: z.string().uuid(),
			},
		},
		async ({ knowledgeBaseId, documentId }) => {
			const denial = denyIfMissingScope(
				deps.subjectScopes,
				"write",
				"delete_document",
			);
			if (denial) return denial;
			const ctx = await resolveKb(deps.store, workspaceId, knowledgeBaseId);
			const { deleted, chunksDropped } = await cascadeDeleteRagDocument({
				store: deps.store,
				drivers: deps.drivers,
				workspace: ctx.workspace,
				knowledgeBase: ctx.knowledgeBase,
				descriptor: ctx.descriptor,
				documentId,
			});
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								outcome: deleted ? "deleted" : "not_found",
								documentId,
								chunksDropped,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}

interface ChatToolDeps extends McpServerDeps {
	readonly chatService: ChatService;
	readonly chatConfig: ChatConfig;
}

function registerChatTool(
	server: McpServer,
	workspaceId: string,
	deps: ChatToolDeps,
): void {
	server.registerTool(
		"chat_send",
		{
			title: "Send a chat message",
			description:
				"Persist a user turn in an agent-owned conversation, retrieve grounding context across the conversation's KB filter, run the configured chat-completion model, persist the assistant reply, and return the assistant text. Use `run_agent` when you want the tool to resolve or create the conversation for you. Returns the assistant content as a single text block (streaming via MCP progress isn't surfaced by most clients yet).",
			inputSchema: {
				agentId: z.string().uuid(),
				chatId: z.string().uuid(),
				content: z.string().min(1).max(32_000),
			},
		},
		async ({ agentId, chatId, content }) => {
			const chat = await deps.store.getConversation(
				workspaceId,
				agentId,
				chatId,
			);
			if (!chat) {
				return {
					isError: true,
					content: [{ type: "text", text: `chat '${chatId}' not found` }],
				};
			}
			const outcome = await runAgentTurn(
				{
					store: deps.store,
					drivers: deps.drivers,
					embedders: deps.embedders,
					chatService: deps.chatService,
					chatConfig: deps.chatConfig,
				},
				{
					workspaceId,
					agentId,
					chatId,
					content,
					knowledgeBaseIds: chat.knowledgeBaseIds,
					principal: deps.principal ?? null,
				},
			);
			return {
				isError: outcome.finishReason === "error",
				content: [{ type: "text", text: outcome.replyText }],
			};
		},
	);
}

/**
 * Wire `create_knowledge_base` onto the MCP server. Wraps the same
 * {@link KnowledgeBaseService.create} call the REST
 * `POST /knowledge-bases` route uses — so the collection-provision
 * + rollback dance runs identically across the two front doors.
 *
 * Outcomes mirror the REST route:
 *   - **created**       — KB row + (for owned mode) the underlying
 *                        vector collection are both in place; the tool
 *                        returns the new `knowledgeBaseId`, the resolved
 *                        `vectorCollection`, and the `owned` flag.
 *   - **kb_name_taken** — another KB in the workspace already binds
 *                        this name. Returned as `isError: true` with
 *                        a recognizable code so the caller can branch.
 *   - **collection_name_taken** — owned-mode create where the chosen
 *                        `name` collides with an existing data-plane
 *                        collection. The KB row is NOT written.
 *
 * Other validation errors (missing chunking/embedding service, attach
 * mode mismatches, vector-dimension drift) propagate as MCP tool
 * errors with the underlying message — the caller learns enough to
 * fix the call without us re-implementing every shape check here.
 */
function registerCreateKnowledgeBaseTool(
	server: McpServer,
	workspaceId: string,
	knowledgeBaseService: KnowledgeBaseService,
	subjectScopes: readonly string[] | null,
): void {
	server.registerTool(
		"create_knowledge_base",
		{
			title: "Create a knowledge base",
			description:
				'Provision a new knowledge base in this workspace, bound to existing chunking + embedding services. Owned KBs (default) auto-provision a vector collection named after `name`; pass `attach: true` plus `vectorCollection` to bind to a pre-existing data-plane collection instead. Returns `outcome: "created"` plus the new `knowledgeBaseId` on success, or `isError: true` with a recognizable code on `kb_name_taken` / `collection_name_taken` / validation failures. **Requires the `write` scope on the calling key.**',
			inputSchema: {
				name: z.string().min(1).max(120),
				chunkingServiceId: z.string().uuid(),
				embeddingServiceId: z.string().uuid(),
				description: z.string().nullable().optional(),
				rerankingServiceId: z.string().uuid().nullable().optional(),
				language: z.string().nullable().optional(),
				attach: z.boolean().optional(),
				vectorCollection: z.string().nullable().optional(),
			},
		},
		async ({
			name,
			chunkingServiceId,
			embeddingServiceId,
			description,
			rerankingServiceId,
			language,
			attach,
			vectorCollection,
		}) => {
			const denial = denyIfMissingScope(
				subjectScopes,
				"write",
				"create_knowledge_base",
			);
			if (denial) return denial;
			try {
				const outcome = await knowledgeBaseService.create(workspaceId, {
					name,
					chunkingServiceId,
					embeddingServiceId,
					...(description !== undefined && { description }),
					...(rerankingServiceId !== undefined && { rerankingServiceId }),
					...(language !== undefined && { language }),
					...(attach !== undefined && { attach }),
					...(vectorCollection !== undefined && { vectorCollection }),
				});
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									outcome: "created",
									knowledgeBaseId: outcome.record.knowledgeBaseId,
									name: outcome.record.name,
									vectorCollection: outcome.record.vectorCollection,
									owned: outcome.record.owned,
									chunkingServiceId: outcome.record.chunkingServiceId,
									embeddingServiceId: outcome.record.embeddingServiceId,
									rerankingServiceId: outcome.record.rerankingServiceId,
									language: outcome.record.language,
									status: outcome.record.status,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (err) {
				if (err instanceof ApiError) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										outcome: "error",
										code: err.code,
										message: err.message,
									},
									null,
									2,
								),
							},
						],
					};
				}
				if (err instanceof ControlPlaneNotFoundError) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										outcome: "not_found",
										message: err.message,
									},
									null,
									2,
								),
							},
						],
					};
				}
				throw err;
			}
		},
	);
}

/**
 * Wire `delete_knowledge_base` onto the MCP server. Wraps the same
 * {@link KnowledgeBaseService.delete} call the REST
 * `DELETE /knowledge-bases/{id}` route uses, so owned KBs drop the
 * underlying vector collection first and attached KBs are detached
 * without touching the collection (consistent with REST semantics).
 *
 * Outcomes:
 *   - **deleted**   — the KB row existed and is gone (along with the
 *                    collection for owned KBs).
 *   - **not_found** — no KB matched the id. Returned as a non-error
 *                    text content so an agent doing speculative
 *                    cleanup doesn't have to branch on `isError`.
 */
function registerDeleteKnowledgeBaseTool(
	server: McpServer,
	workspaceId: string,
	knowledgeBaseService: KnowledgeBaseService,
	subjectScopes: readonly string[] | null,
): void {
	server.registerTool(
		"delete_knowledge_base",
		{
			title: "Delete a knowledge base",
			description:
				'Remove a knowledge base from this workspace. For owned KBs, the underlying vector collection is dropped first; attached KBs are detached without touching the collection (consistent with the REST DELETE semantics). Idempotent — re-deleting a missing KB returns `outcome: "not_found"` rather than erroring. **Requires the `write` scope on the calling key.**',
			inputSchema: {
				knowledgeBaseId: z.string().uuid(),
			},
		},
		async ({ knowledgeBaseId }) => {
			const denial = denyIfMissingScope(
				subjectScopes,
				"write",
				"delete_knowledge_base",
			);
			if (denial) return denial;
			try {
				await knowledgeBaseService.delete(workspaceId, knowledgeBaseId);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{ outcome: "deleted", knowledgeBaseId },
								null,
								2,
							),
						},
					],
				};
			} catch (err) {
				if (err instanceof ControlPlaneNotFoundError) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{ outcome: "not_found", knowledgeBaseId },
									null,
									2,
								),
							},
						],
					};
				}
				throw err;
			}
		},
	);
}

/**
 * Wire `run_agent` onto the MCP server. The one-call form of
 * `chat_send` — accepts an `agentId` (which the caller already has
 * from `list_agents` / `get_agent`) and either resumes an existing
 * conversation or creates a new one bound to the agent's
 * `knowledgeBaseIds`. Drives the same orchestration helper
 * `chat_send` uses, so retrieval, prompt assembly, completion, and
 * persistence are pixel-identical between the two tools.
 *
 * Wire envelope:
 *   - **success** — `{ outcome: "completed", conversationId, content,
 *                    finishReason, tokenCount, contextChunkIds }`.
 *   - **agent_not_found** — `isError: true`, the agent id didn't match
 *                    any agent in the workspace.
 *   - **chat_not_found** — `isError: true`, the supplied `conversationId`
 *                    isn't a conversation for this agent.
 *   - **completion_error** — `isError: true`, the chat model returned
 *                    `finishReason: "error"`. The text is still
 *                    persisted (consistent with `chat_send`).
 */
function registerRunAgentTool(
	server: McpServer,
	workspaceId: string,
	deps: ChatToolDeps,
): void {
	server.registerTool(
		"run_agent",
		{
			title: "Run an agent",
			description:
				"One-call agent invocation: load the agent by id, resume or create a conversation bound to the agent's KB set, run a single user turn through the retrieve → prompt → complete → persist pipeline, and return the assistant reply alongside the conversation id so the caller can follow up. Pass `conversationId` to extend an existing chat; omit it to create a fresh conversation. Returns the structured outcome (with `finishReason` and `tokenCount`) rather than a bare text block so callers can branch programmatically. Honors the agent's stored `systemPrompt` when present.",
			inputSchema: {
				agentId: z.string().uuid(),
				content: z.string().min(1).max(32_000),
				conversationId: z.string().uuid().optional(),
				title: z.string().min(1).max(120).optional(),
			},
		},
		async ({ agentId, content, conversationId, title }) => {
			const agent = await deps.store.getAgent(workspaceId, agentId);
			if (!agent) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									outcome: "agent_not_found",
									agentId,
									message: `No agent ${agentId} in this workspace.`,
								},
								null,
								2,
							),
						},
					],
				};
			}

			let chatId = conversationId ?? null;
			let knowledgeBaseIds: readonly string[] = agent.knowledgeBaseIds;
			if (chatId) {
				const existing = await deps.store.getConversation(
					workspaceId,
					agentId,
					chatId,
				);
				if (!existing) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										outcome: "chat_not_found",
										conversationId: chatId,
										agentId,
										message: `Conversation ${chatId} not found for agent ${agentId}.`,
									},
									null,
									2,
								),
							},
						],
					};
				}
				knowledgeBaseIds = existing.knowledgeBaseIds;
			} else {
				const created = await deps.store.createConversation(
					workspaceId,
					agentId,
					{
						...(title !== undefined && { title }),
						knowledgeBaseIds: agent.knowledgeBaseIds,
					},
				);
				chatId = created.conversationId;
			}

			const outcome = await runAgentTurn(
				{
					store: deps.store,
					drivers: deps.drivers,
					embedders: deps.embedders,
					chatService: deps.chatService,
					chatConfig: deps.chatConfig,
				},
				{
					workspaceId,
					agentId,
					chatId,
					content,
					knowledgeBaseIds,
					systemPrompt: agent.systemPrompt,
					principal: deps.principal ?? null,
				},
			);

			return {
				isError: outcome.finishReason === "error",
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								outcome:
									outcome.finishReason === "error"
										? "completion_error"
										: "completed",
								conversationId: chatId,
								agentId,
								content: outcome.replyText,
								finishReason: outcome.finishReason,
								tokenCount: outcome.tokenCount,
								contextChunkIds: outcome.contextChunkIds,
								...(outcome.errorMessage && {
									errorMessage: outcome.errorMessage,
								}),
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}
