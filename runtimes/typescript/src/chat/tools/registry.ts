/**
 * Agent tool registry.
 *
 * Defines the contract for an "agent tool" — a function the model can
 * call mid-turn to look at the workspace's actual data — plus the
 * concrete tools the dispatcher advertises by default.
 *
 * Each tool has three pieces:
 *  - **definition**: name + description + JSON Schema for arguments.
 *    The shape the LLM sees and decides whether to call.
 *  - **argSchema**: a Zod schema mirroring the JSON Schema. Used at
 *    execution time to validate the model's argument payload — the
 *    LLM occasionally hallucinates extra fields or wrong types, and
 *    we want a clean 4xx-style result string in the tool turn rather
 *    than an exception bubbling up.
 *  - **handler**: the actual implementation. Returns a string the
 *    runtime echoes back to the model as the `tool` turn's content.
 *    Plain text or JSON — the model is good at consuming either.
 *
 * Tools intentionally don't take a generic context bag; the registry
 * binds the workspace + store + drivers + embedders + logger at
 * construction time so the LLM-facing arguments stay tight.
 */

import { z } from "@hono/zod-openapi";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { KnowledgeBaseRecord } from "../../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import type { Logger } from "../../lib/logger.js";
import { resolveKb } from "../../routes/api-v1/kb-descriptor.js";
import { dispatchSearch } from "../../routes/api-v1/search-dispatch.js";
import type { ToolDefinition } from "../types.js";

export interface AgentToolDeps {
	readonly workspaceId: string;
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly logger?: Pick<Logger, "warn" | "debug">;
}

export interface AgentTool {
	readonly definition: ToolDefinition;
	/**
	 * Validate `rawArgs` (the LLM's argument JSON, already parsed) and
	 * run the tool. Implementations should return a stringified result
	 * suitable for inclusion in a `tool`-role chat turn.
	 *
	 * Validation failures should be returned as a string starting with
	 * `Error:` so the model can self-correct on the next iteration —
	 * NOT thrown — otherwise the tool-call loop has to translate
	 * exceptions back into tool-turn content anyway.
	 */
	execute(rawArgs: unknown, deps: AgentToolDeps): Promise<string>;
}

/* Soft caps so tool output never blows up the prompt. Tunable. */
const MAX_DOCS_LISTED = 25;
const MAX_KBS_LISTED = 25;
const MAX_SEARCH_RESULTS = 8;
const MAX_CHUNK_PREVIEW_CHARS = 400;

/* ----------------------------- list_kbs ---------------------------- */

const listKbsArgs = z.object({}).strict();

const listKbs: AgentTool = {
	definition: {
		name: "list_kbs",
		description:
			"List the knowledge bases available in this workspace. Use this when the user asks what data sources exist, or before deciding which knowledge base to search.",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	async execute(rawArgs, deps) {
		const parsed = listKbsArgs.safeParse(rawArgs);
		if (!parsed.success) return formatZodError(parsed.error);
		const kbs = await deps.store.listKnowledgeBases(deps.workspaceId);
		if (kbs.length === 0) {
			return "No knowledge bases exist in this workspace yet.";
		}
		const trimmed = kbs.slice(0, MAX_KBS_LISTED).map((kb) => ({
			knowledgeBaseId: kb.knowledgeBaseId,
			name: kb.name,
			description: kb.description ?? null,
		}));
		const overflow = kbs.length > MAX_KBS_LISTED;
		return JSON.stringify({
			knowledgeBases: trimmed,
			...(overflow && { truncated: true, total: kbs.length }),
		});
	},
};

/* -------------------------- list_documents ------------------------- */

const listDocumentsArgs = z
	.object({
		knowledgeBaseId: z.string().uuid().optional(),
	})
	.strict();

const listDocuments: AgentTool = {
	definition: {
		name: "list_documents",
		description:
			"List documents (titles + ids) in a knowledge base. Pass `knowledgeBaseId` to scope to one KB; omit to list across every KB in the workspace. Useful when the user asks 'what's in my data' at the document level.",
		parameters: {
			type: "object",
			properties: {
				knowledgeBaseId: {
					type: "string",
					description:
						"UUID of a knowledge base to scope to. Omit to list documents across every KB in the workspace.",
				},
			},
			additionalProperties: false,
		},
	},
	async execute(rawArgs, deps) {
		const parsed = listDocumentsArgs.safeParse(rawArgs);
		if (!parsed.success) return formatZodError(parsed.error);

		const kbIds = parsed.data.knowledgeBaseId
			? [parsed.data.knowledgeBaseId]
			: (await deps.store.listKnowledgeBases(deps.workspaceId)).map(
					(kb) => kb.knowledgeBaseId,
				);
		if (kbIds.length === 0) {
			return "No knowledge bases exist in this workspace yet.";
		}

		const docs: {
			knowledgeBaseId: string;
			documentId: string;
			sourceFilename: string | null;
			fileType: string | null;
			status: string;
		}[] = [];
		for (const kbId of kbIds) {
			try {
				const list = await deps.store.listRagDocuments(deps.workspaceId, kbId);
				for (const d of list) {
					docs.push({
						knowledgeBaseId: kbId,
						documentId: d.documentId,
						sourceFilename: d.sourceFilename ?? null,
						fileType: d.fileType ?? null,
						status: d.status,
					});
				}
			} catch (err) {
				deps.logger?.warn?.(
					{ err, workspaceId: deps.workspaceId, knowledgeBaseId: kbId },
					"list_documents tool failed for one KB; skipping",
				);
			}
		}

		if (docs.length === 0) return "No documents are registered yet.";
		const trimmed = docs.slice(0, MAX_DOCS_LISTED);
		const overflow = docs.length > MAX_DOCS_LISTED;
		return JSON.stringify({
			documents: trimmed,
			...(overflow && { truncated: true, total: docs.length }),
		});
	},
};

/* -------------------------- count_documents ------------------------ */

const countDocumentsArgs = z
	.object({
		knowledgeBaseId: z.string().uuid().optional(),
	})
	.strict();

const countDocuments: AgentTool = {
	definition: {
		name: "count_documents",
		description:
			"Count how many documents are registered in a knowledge base. Pass `knowledgeBaseId` to scope; omit to count across every KB in the workspace. Cheaper than list_documents when only the magnitude matters.",
		parameters: {
			type: "object",
			properties: {
				knowledgeBaseId: {
					type: "string",
					description:
						"UUID of a knowledge base. Omit to count workspace-wide.",
				},
			},
			additionalProperties: false,
		},
	},
	async execute(rawArgs, deps) {
		const parsed = countDocumentsArgs.safeParse(rawArgs);
		if (!parsed.success) return formatZodError(parsed.error);
		const kbIds = parsed.data.knowledgeBaseId
			? [parsed.data.knowledgeBaseId]
			: (await deps.store.listKnowledgeBases(deps.workspaceId)).map(
					(kb) => kb.knowledgeBaseId,
				);
		const counts: { knowledgeBaseId: string; documentCount: number }[] = [];
		for (const kbId of kbIds) {
			try {
				const list = await deps.store.listRagDocuments(deps.workspaceId, kbId);
				counts.push({ knowledgeBaseId: kbId, documentCount: list.length });
			} catch {
				counts.push({ knowledgeBaseId: kbId, documentCount: 0 });
			}
		}
		const total = counts.reduce((sum, c) => sum + c.documentCount, 0);
		return JSON.stringify({ total, perKnowledgeBase: counts });
	},
};

/* --------------------------- summarize_kb -------------------------- */

const summarizeKbArgs = z
	.object({
		knowledgeBaseId: z.string().uuid().optional(),
	})
	.strict();

const summarizeKb: AgentTool = {
	definition: {
		name: "summarize_kb",
		description:
			"Quick at-a-glance summary of a knowledge base: name, description, document count, and a short sample of document titles. Pass `knowledgeBaseId` to summarize one KB; omit to summarize each KB in the workspace. Use this for meta queries like 'what's in my data?' or 'tell me about my workspace'.",
		parameters: {
			type: "object",
			properties: {
				knowledgeBaseId: {
					type: "string",
					description:
						"UUID of a knowledge base. Omit to summarize every KB in the workspace.",
				},
			},
			additionalProperties: false,
		},
	},
	async execute(rawArgs, deps) {
		const parsed = summarizeKbArgs.safeParse(rawArgs);
		if (!parsed.success) return formatZodError(parsed.error);

		let kbs: KnowledgeBaseRecord[];
		if (parsed.data.knowledgeBaseId) {
			const one = await deps.store.getKnowledgeBase(
				deps.workspaceId,
				parsed.data.knowledgeBaseId,
			);
			if (!one) {
				return `Error: knowledge base ${parsed.data.knowledgeBaseId} not found.`;
			}
			kbs = [one];
		} else {
			kbs = [...(await deps.store.listKnowledgeBases(deps.workspaceId))];
		}

		if (kbs.length === 0) {
			return "No knowledge bases exist in this workspace yet.";
		}

		const summaries: {
			knowledgeBaseId: string;
			name: string;
			description: string | null;
			documentCount: number;
			sampleDocuments: { documentId: string; sourceFilename: string | null }[];
		}[] = [];
		for (const kb of kbs) {
			try {
				const docs = await deps.store.listRagDocuments(
					deps.workspaceId,
					kb.knowledgeBaseId,
				);
				summaries.push({
					knowledgeBaseId: kb.knowledgeBaseId,
					name: kb.name,
					description: kb.description ?? null,
					documentCount: docs.length,
					sampleDocuments: docs.slice(0, 5).map((d) => ({
						documentId: d.documentId,
						sourceFilename: d.sourceFilename ?? null,
					})),
				});
			} catch (err) {
				deps.logger?.warn?.(
					{ err, kb: kb.knowledgeBaseId },
					"summarize_kb failed to enumerate documents",
				);
				summaries.push({
					knowledgeBaseId: kb.knowledgeBaseId,
					name: kb.name,
					description: kb.description ?? null,
					documentCount: 0,
					sampleDocuments: [],
				});
			}
		}
		return JSON.stringify({ summaries });
	},
};

/* ---------------------------- search_kb ---------------------------- */

const searchKbArgs = z
	.object({
		query: z.string().min(1),
		knowledgeBaseId: z.string().uuid().optional(),
		limit: z.number().int().positive().max(MAX_SEARCH_RESULTS).optional(),
	})
	.strict();

const searchKb: AgentTool = {
	definition: {
		name: "search_kb",
		description:
			"Semantic search across the workspace's knowledge bases. Returns the top matching chunks with a short content preview. Use this when the user asks a content question that requires looking inside the documents (not just listing them). Pass `knowledgeBaseId` to scope to one KB; omit to search every KB.",
		parameters: {
			type: "object",
			required: ["query"],
			properties: {
				query: {
					type: "string",
					description:
						"Natural-language question or phrase to search for, e.g. 'how does the billing flow work?'.",
				},
				knowledgeBaseId: {
					type: "string",
					description:
						"UUID of a knowledge base to scope to. Omit to search workspace-wide.",
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: MAX_SEARCH_RESULTS,
					description: `Max chunks to return (default 5, hard cap ${MAX_SEARCH_RESULTS}).`,
				},
			},
			additionalProperties: false,
		},
	},
	async execute(rawArgs, deps) {
		const parsed = searchKbArgs.safeParse(rawArgs);
		if (!parsed.success) return formatZodError(parsed.error);
		const limit = parsed.data.limit ?? 5;

		const kbIds = parsed.data.knowledgeBaseId
			? [parsed.data.knowledgeBaseId]
			: (await deps.store.listKnowledgeBases(deps.workspaceId)).map(
					(kb) => kb.knowledgeBaseId,
				);
		if (kbIds.length === 0) {
			return "No knowledge bases exist in this workspace yet.";
		}

		const hits: {
			knowledgeBaseId: string;
			documentId: string | null;
			chunkId: string;
			score: number;
			contentPreview: string;
		}[] = [];
		for (const kbId of kbIds) {
			try {
				const ctx = await resolveKb(deps.store, deps.workspaceId, kbId);
				const driver = deps.drivers.for(ctx.workspace);
				const raw = await dispatchSearch({
					ctx,
					driver,
					embedders: deps.embedders,
					body: { text: parsed.data.query, topK: limit },
				});
				for (const hit of raw) {
					const payload = hit.payload ?? {};
					const content =
						typeof payload.content === "string"
							? payload.content
							: typeof payload.text === "string"
								? payload.text
								: "";
					hits.push({
						knowledgeBaseId: kbId,
						documentId:
							typeof payload.documentId === "string"
								? payload.documentId
								: null,
						chunkId: hit.id,
						score: hit.score,
						contentPreview: truncate(content, MAX_CHUNK_PREVIEW_CHARS),
					});
				}
			} catch (err) {
				deps.logger?.warn?.(
					{ err, kb: kbId },
					"search_kb failed for one KB; skipping",
				);
			}
		}

		if (hits.length === 0) {
			return "No matching content found in any knowledge base.";
		}
		hits.sort((a, b) => b.score - a.score);
		return JSON.stringify({ results: hits.slice(0, limit) });
	},
};

/* ---------------------------- get_document ------------------------- */

const getDocumentArgs = z
	.object({
		knowledgeBaseId: z.string().uuid(),
		documentId: z.string().uuid(),
	})
	.strict();

const getDocument: AgentTool = {
	definition: {
		name: "get_document",
		description:
			"Fetch a single document's metadata + a short content preview. Use after list_documents/search_kb when the user asks for details on a specific item.",
		parameters: {
			type: "object",
			required: ["knowledgeBaseId", "documentId"],
			properties: {
				knowledgeBaseId: {
					type: "string",
					description: "Knowledge base UUID.",
				},
				documentId: { type: "string", description: "Document UUID." },
			},
			additionalProperties: false,
		},
	},
	async execute(rawArgs, deps) {
		const parsed = getDocumentArgs.safeParse(rawArgs);
		if (!parsed.success) return formatZodError(parsed.error);
		const doc = await deps.store.getRagDocument(
			deps.workspaceId,
			parsed.data.knowledgeBaseId,
			parsed.data.documentId,
		);
		if (!doc) {
			return `Error: document ${parsed.data.documentId} not found in knowledge base ${parsed.data.knowledgeBaseId}.`;
		}
		return JSON.stringify({
			documentId: doc.documentId,
			knowledgeBaseId: doc.knowledgeBaseId,
			sourceFilename: doc.sourceFilename ?? null,
			fileType: doc.fileType ?? null,
			fileSize: doc.fileSize ?? null,
			chunkTotal: doc.chunkTotal ?? null,
			status: doc.status,
			ingestedAt: doc.ingestedAt ?? null,
			metadata: doc.metadata,
		});
	},
};

/* --------------------------- public registry ----------------------- */

/**
 * Default set of agent-callable tools. Order is the order the LLM sees
 * them; cheap/meta tools (list, count, summarize) are advertised before
 * the more expensive `search_kb` so the model is biased toward the
 * lighter-weight option when both would work.
 */
export const DEFAULT_AGENT_TOOLS: readonly AgentTool[] = Object.freeze([
	listKbs,
	listDocuments,
	countDocuments,
	summarizeKb,
	searchKb,
	getDocument,
]);

export function defaultToolDefinitions(): readonly ToolDefinition[] {
	return DEFAULT_AGENT_TOOLS.map((t) => t.definition);
}

/**
 * Resolve a tool by name. Returns `null` when the model hallucinated a
 * tool that doesn't exist — the dispatcher echoes a `tool` turn with
 * an `Error: unknown tool` body so the model can recover.
 */
export function resolveTool(name: string): AgentTool | null {
	return DEFAULT_AGENT_TOOLS.find((t) => t.definition.name === name) ?? null;
}

/* ------------------------------ helpers ---------------------------- */

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}

function formatZodError(err: z.ZodError): string {
	const issues = err.issues
		.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
		.join("; ");
	return `Error: invalid arguments — ${issues}.`;
}
