/**
 * JSON-on-disk {@link ../store.ControlPlaneStore} for single-node
 * self-hosted deployments.
 *
 * Layout:
 *   <root>/workspaces.json          : WorkspaceRecord[]
 *   <root>/api-keys.json            : ApiKeyRecord[]
 *   <root>/knowledge-bases.json     : KnowledgeBaseRecord[]
 *   <root>/chunking-services.json   : ChunkingServiceRecord[]
 *   <root>/embedding-services.json  : EmbeddingServiceRecord[]
 *   <root>/reranking-services.json  : RerankingServiceRecord[]
 *   <root>/llm-services.json        : LlmServiceRecord[]
 *   <root>/rag-documents.json       : RagDocumentRecord[]
 *
 * Each mutation:
 *   1. Acquires the per-file mutex.
 *   2. Reads the file (creating an empty array if absent).
 *   3. Applies the change in memory.
 *   4. Writes to `<file>.tmp` then atomically renames over `<file>`.
 *
 * Not safe for multi-writer setups (multiple processes writing the same
 * directory) — that's what the astra backend is for.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	byCreatedAtThenKeyId,
	byCreatedAtThenUid,
	DEFAULT_AUTH_TYPE,
	DEFAULT_DISTANCE_METRIC,
	DEFAULT_KB_STATUS,
	DEFAULT_LEXICAL,
	DEFAULT_SERVICE_STATUS,
	defaultVectorCollection,
	nowIso,
} from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import type {
	AppendChatMessageInput,
	ControlPlaneStore,
	CreateAgentInput,
	CreateChunkingServiceInput,
	CreateConversationInput,
	CreateEmbeddingServiceInput,
	CreateKnowledgeBaseInput,
	CreateKnowledgeFilterInput,
	CreateLlmServiceInput,
	CreateRagDocumentInput,
	CreateRerankingServiceInput,
	CreateWorkspaceInput,
	PersistApiKeyInput,
	UpdateAgentInput,
	UpdateChatMessageInput,
	UpdateChunkingServiceInput,
	UpdateConversationInput,
	UpdateEmbeddingServiceInput,
	UpdateKnowledgeBaseInput,
	UpdateKnowledgeFilterInput,
	UpdateLlmServiceInput,
	UpdateRagDocumentInput,
	UpdateRerankingServiceInput,
	UpdateWorkspaceInput,
} from "../store.js";
import type {
	AgentRecord,
	ApiKeyRecord,
	ChunkingServiceRecord,
	ConversationRecord,
	EmbeddingServiceRecord,
	KnowledgeBaseRecord,
	KnowledgeFilterRecord,
	LlmServiceRecord,
	MessageRecord,
	RagDocumentRecord,
	RerankingServiceRecord,
	WorkspaceRecord,
} from "../types.js";
import { Mutex } from "./mutex.js";

type Table =
	| "workspaces"
	| "api-keys"
	// Knowledge-base schema (issue #98).
	| "knowledge-bases"
	| "knowledge-filters"
	| "chunking-services"
	| "embedding-services"
	| "reranking-services"
	| "llm-services"
	| "rag-documents"
	// Agentic tables (Stage-2 schema).
	| "agents"
	| "conversations"
	| "messages";

const TABLE_FILES: Record<Table, string> = {
	workspaces: "workspaces.json",
	"api-keys": "api-keys.json",
	"knowledge-bases": "knowledge-bases.json",
	"knowledge-filters": "knowledge-filters.json",
	"chunking-services": "chunking-services.json",
	"embedding-services": "embedding-services.json",
	"reranking-services": "reranking-services.json",
	"llm-services": "llm-services.json",
	"rag-documents": "rag-documents.json",
	agents: "agents.json",
	conversations: "conversations.json",
	messages: "messages.json",
};

function freezeStringSet(
	value: ReadonlySet<string> | readonly string[] | undefined,
): readonly string[] {
	return Object.freeze([...new Set(value ?? [])].sort());
}

/**
 * Newest-first sort for chat conversations, matching the Astra
 * `created_at DESC` cluster ordering. Tie-break by conversation_id
 * for total ordering across same-tick creates.
 */
function byCreatedAtDescConv(
	a: ConversationRecord,
	b: ConversationRecord,
): number {
	if (a.createdAt > b.createdAt) return -1;
	if (a.createdAt < b.createdAt) return 1;
	if (a.conversationId < b.conversationId) return -1;
	if (a.conversationId > b.conversationId) return 1;
	return 0;
}

/**
 * Oldest-first sort for agent rows. Agent listing uses creation order
 * so the first-created agent sits at the top. Tie-break by agent_id
 * for stability.
 */
function byCreatedAtAscAgent(a: AgentRecord, b: AgentRecord): number {
	if (a.createdAt < b.createdAt) return -1;
	if (a.createdAt > b.createdAt) return 1;
	if (a.agentId < b.agentId) return -1;
	if (a.agentId > b.agentId) return 1;
	return 0;
}

/**
 * Oldest-first sort for chat messages, matching the Astra
 * `message_ts ASC` cluster ordering. UI flips for display.
 */
function byMessageTsAsc(a: MessageRecord, b: MessageRecord): number {
	if (a.messageTs < b.messageTs) return -1;
	if (a.messageTs > b.messageTs) return 1;
	if (a.messageId < b.messageId) return -1;
	if (a.messageId > b.messageId) return 1;
	return 0;
}

/**
 * Merge a message metadata patch into the existing map.
 * `undefined`-valued patch entries drop the corresponding key
 * (matches the {@link UpdateChatMessageInput} contract).
 */
function mergeMessageMetadata(
	existing: Readonly<Record<string, string>>,
	patch: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
	const next: Record<string, string> = { ...existing };
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) delete next[k];
		else next[k] = v;
	}
	return Object.freeze(next);
}

export interface FileControlPlaneOptions {
	readonly root: string;
}

export class FileControlPlaneStore implements ControlPlaneStore {
	private readonly root: string;
	private readonly mutexes: Record<Table, Mutex> = {
		workspaces: new Mutex(),
		"api-keys": new Mutex(),
		"knowledge-bases": new Mutex(),
		"knowledge-filters": new Mutex(),
		"chunking-services": new Mutex(),
		"embedding-services": new Mutex(),
		"reranking-services": new Mutex(),
		"llm-services": new Mutex(),
		"rag-documents": new Mutex(),
		agents: new Mutex(),
		conversations: new Mutex(),
		messages: new Mutex(),
	};

	constructor(opts: FileControlPlaneOptions) {
		this.root = opts.root;
	}

	async init(): Promise<void> {
		await mkdir(this.root, { recursive: true });
	}

	/* ---------------- Workspaces ---------------- */

	async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
		const all = await this.readAll<WorkspaceRecord>("workspaces");
		return [...all].sort(byCreatedAtThenUid);
	}

	async getWorkspace(uid: string): Promise<WorkspaceRecord | null> {
		const all = await this.readAll<WorkspaceRecord>("workspaces");
		return all.find((w) => w.uid === uid) ?? null;
	}

	async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
		return this.mutate<"workspaces", WorkspaceRecord>("workspaces", (rows) => {
			const uid = input.uid ?? randomUUID();
			if (rows.some((w) => w.uid === uid)) {
				throw new ControlPlaneConflictError(
					`workspace with uid '${uid}' already exists`,
				);
			}
			const now = nowIso();
			const record: WorkspaceRecord = {
				uid,
				name: input.name,
				url: input.url ?? null,
				kind: input.kind,
				credentials: { ...(input.credentials ?? {}) },
				keyspace: input.keyspace ?? null,
				createdAt: now,
				updatedAt: now,
			};
			return { rows: [...rows, record], result: record };
		});
	}

	async updateWorkspace(
		uid: string,
		patch: UpdateWorkspaceInput,
	): Promise<WorkspaceRecord> {
		return this.mutate<"workspaces", WorkspaceRecord>("workspaces", (rows) => {
			const idx = rows.findIndex((w) => w.uid === uid);
			if (idx < 0) {
				throw new ControlPlaneNotFoundError("workspace", uid);
			}
			const existing = rows[idx] as WorkspaceRecord;
			const next: WorkspaceRecord = {
				...existing,
				...(patch.name !== undefined && { name: patch.name }),
				...(patch.url !== undefined && { url: patch.url }),
				...(patch.credentials !== undefined && {
					credentials: { ...patch.credentials },
				}),
				...(patch.keyspace !== undefined && { keyspace: patch.keyspace }),
				updatedAt: nowIso(),
			};
			const nextRows = [...rows];
			nextRows[idx] = next;
			return { rows: nextRows, result: next };
		});
	}

	async deleteWorkspace(uid: string): Promise<{ deleted: boolean }> {
		// Cascade across tables. Each cascade is independently locked; we
		// accept eventual consistency across tables, which is fine for
		// single-node and matches how astra would behave (no cross-partition
		// transaction).
		const workspaceDeleted = await this.mutate<
			"workspaces",
			{ deleted: boolean }
		>("workspaces", (rows) => {
			const next = rows.filter((w) => w.uid !== uid);
			return {
				rows: next,
				result: { deleted: next.length !== rows.length },
			};
		});

		await this.mutate<"api-keys", null>("api-keys", (rows) => ({
			rows: rows.filter((k) => k.workspace !== uid),
			result: null,
		}));
		// Knowledge-base schema cascades.
		await this.mutate<"knowledge-bases", null>("knowledge-bases", (rows) => ({
			rows: rows.filter((kb) => kb.workspaceId !== uid),
			result: null,
		}));
		await this.mutate<"knowledge-filters", null>(
			"knowledge-filters",
			(rows) => ({
				rows: rows.filter((f) => f.workspaceId !== uid),
				result: null,
			}),
		);
		await this.mutate<"chunking-services", null>(
			"chunking-services",
			(rows) => ({
				rows: rows.filter((s) => s.workspaceId !== uid),
				result: null,
			}),
		);
		await this.mutate<"embedding-services", null>(
			"embedding-services",
			(rows) => ({
				rows: rows.filter((s) => s.workspaceId !== uid),
				result: null,
			}),
		);
		await this.mutate<"reranking-services", null>(
			"reranking-services",
			(rows) => ({
				rows: rows.filter((s) => s.workspaceId !== uid),
				result: null,
			}),
		);
		await this.mutate<"llm-services", null>("llm-services", (rows) => ({
			rows: rows.filter((s) => s.workspaceId !== uid),
			result: null,
		}));
		await this.mutate<"rag-documents", null>("rag-documents", (rows) => ({
			rows: rows.filter((d) => d.workspaceId !== uid),
			result: null,
		}));

		// Chat cascade: agents → conversations → messages.
		await this.mutate<"agents", null>("agents", (rows) => ({
			rows: rows.filter((a) => a.workspaceId !== uid),
			result: null,
		}));
		await this.mutate<"conversations", null>("conversations", (rows) => ({
			rows: rows.filter((c) => c.workspaceId !== uid),
			result: null,
		}));
		await this.mutate<"messages", null>("messages", (rows) => ({
			rows: rows.filter((m) => m.workspaceId !== uid),
			result: null,
		}));

		return workspaceDeleted;
	}

	/* ---------------- API keys ---------------- */

	async listApiKeys(workspace: string): Promise<readonly ApiKeyRecord[]> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<ApiKeyRecord>("api-keys");
		return all
			.filter((k) => k.workspace === workspace)
			.sort(byCreatedAtThenKeyId);
	}

	async getApiKey(
		workspace: string,
		keyId: string,
	): Promise<ApiKeyRecord | null> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<ApiKeyRecord>("api-keys");
		return (
			all.find((k) => k.workspace === workspace && k.keyId === keyId) ?? null
		);
	}

	async persistApiKey(
		workspace: string,
		input: PersistApiKeyInput,
	): Promise<ApiKeyRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"api-keys", ApiKeyRecord>("api-keys", (rows) => {
			if (rows.some((k) => k.prefix === input.prefix)) {
				throw new ControlPlaneConflictError(
					`api key with prefix '${input.prefix}' already exists`,
				);
			}
			if (
				rows.some((k) => k.workspace === workspace && k.keyId === input.keyId)
			) {
				throw new ControlPlaneConflictError(
					`api key with id '${input.keyId}' already exists in workspace '${workspace}'`,
				);
			}
			const record: ApiKeyRecord = {
				workspace,
				keyId: input.keyId,
				prefix: input.prefix,
				hash: input.hash,
				label: input.label,
				createdAt: nowIso(),
				lastUsedAt: null,
				revokedAt: null,
				expiresAt: input.expiresAt ?? null,
			};
			return { rows: [...rows, record], result: record };
		});
	}

	async revokeApiKey(
		workspace: string,
		keyId: string,
	): Promise<{ revoked: boolean }> {
		await this.assertWorkspace(workspace);
		return this.mutate<"api-keys", { revoked: boolean }>("api-keys", (rows) => {
			const idx = rows.findIndex(
				(k) => k.workspace === workspace && k.keyId === keyId,
			);
			if (idx < 0) return { rows, result: { revoked: false } };
			const existing = rows[idx] as ApiKeyRecord;
			if (existing.revokedAt !== null) {
				return { rows, result: { revoked: false } };
			}
			const next = [...rows];
			next[idx] = { ...existing, revokedAt: nowIso() };
			return { rows: next, result: { revoked: true } };
		});
	}

	async findApiKeyByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
		const all = await this.readAll<ApiKeyRecord>("api-keys");
		return all.find((k) => k.prefix === prefix) ?? null;
	}

	async touchApiKey(workspace: string, keyId: string): Promise<void> {
		await this.mutate<"api-keys", null>("api-keys", (rows) => {
			const idx = rows.findIndex(
				(k) => k.workspace === workspace && k.keyId === keyId,
			);
			if (idx < 0) return { rows, result: null };
			const next = [...rows];
			next[idx] = { ...(rows[idx] as ApiKeyRecord), lastUsedAt: nowIso() };
			return { rows: next, result: null };
		});
	}

	/* ---------------- Knowledge bases (issue #98) ---------------- */

	async listKnowledgeBases(
		workspace: string,
	): Promise<readonly KnowledgeBaseRecord[]> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<KnowledgeBaseRecord>("knowledge-bases");
		return all.filter((kb) => kb.workspaceId === workspace);
	}

	async getKnowledgeBase(
		workspace: string,
		uid: string,
	): Promise<KnowledgeBaseRecord | null> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<KnowledgeBaseRecord>("knowledge-bases");
		return (
			all.find(
				(kb) => kb.workspaceId === workspace && kb.knowledgeBaseId === uid,
			) ?? null
		);
	}

	async createKnowledgeBase(
		workspace: string,
		input: CreateKnowledgeBaseInput,
	): Promise<KnowledgeBaseRecord> {
		await this.assertWorkspace(workspace);
		await this.assertEmbeddingService(workspace, input.embeddingServiceId);
		await this.assertChunkingService(workspace, input.chunkingServiceId);
		if (input.rerankingServiceId) {
			await this.assertRerankingService(workspace, input.rerankingServiceId);
		}
		return this.mutate<"knowledge-bases", KnowledgeBaseRecord>(
			"knowledge-bases",
			(rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(kb) => kb.workspaceId === workspace && kb.knowledgeBaseId === uid,
					)
				) {
					throw new ControlPlaneConflictError(
						`knowledge base with uid '${uid}' already exists in workspace '${workspace}'`,
					);
				}
				const now = nowIso();
				const record: KnowledgeBaseRecord = {
					workspaceId: workspace,
					knowledgeBaseId: uid,
					name: input.name,
					description: input.description ?? null,
					status: input.status ?? DEFAULT_KB_STATUS,
					embeddingServiceId: input.embeddingServiceId,
					chunkingServiceId: input.chunkingServiceId,
					rerankingServiceId: input.rerankingServiceId ?? null,
					language: input.language ?? null,
					vectorCollection:
						input.vectorCollection ?? defaultVectorCollection(uid),
					lexical: input.lexical ?? DEFAULT_LEXICAL,
					createdAt: now,
					updatedAt: now,
				};
				return { rows: [...rows, record], result: record };
			},
		);
	}

	async updateKnowledgeBase(
		workspace: string,
		uid: string,
		patch: UpdateKnowledgeBaseInput,
	): Promise<KnowledgeBaseRecord> {
		await this.assertWorkspace(workspace);
		if (
			patch.rerankingServiceId !== undefined &&
			patch.rerankingServiceId !== null
		) {
			await this.assertRerankingService(workspace, patch.rerankingServiceId);
		}
		return this.mutate<"knowledge-bases", KnowledgeBaseRecord>(
			"knowledge-bases",
			(rows) => {
				const idx = rows.findIndex(
					(kb) => kb.workspaceId === workspace && kb.knowledgeBaseId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("knowledge base", uid);
				}
				const existing = rows[idx] as KnowledgeBaseRecord;
				const next: KnowledgeBaseRecord = {
					...existing,
					...(patch.name !== undefined && { name: patch.name }),
					...(patch.description !== undefined && {
						description: patch.description,
					}),
					...(patch.status !== undefined && { status: patch.status }),
					...(patch.rerankingServiceId !== undefined && {
						rerankingServiceId: patch.rerankingServiceId,
					}),
					...(patch.language !== undefined && { language: patch.language }),
					...(patch.lexical !== undefined && { lexical: patch.lexical }),
					updatedAt: nowIso(),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			},
		);
	}

	async deleteKnowledgeBase(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		const res = await this.mutate<"knowledge-bases", { deleted: boolean }>(
			"knowledge-bases",
			(rows) => {
				const next = rows.filter(
					(kb) => !(kb.workspaceId === workspace && kb.knowledgeBaseId === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
		// Cascade RAG document rows. Underlying vector collection cleanup
		// is the caller's responsibility (KB delete route handles it).
		await this.mutate<"rag-documents", null>("rag-documents", (rows) => ({
			rows: rows.filter(
				(d) => !(d.workspaceId === workspace && d.knowledgeBaseId === uid),
			),
			result: null,
		}));
		await this.mutate<"knowledge-filters", null>(
			"knowledge-filters",
			(rows) => ({
				rows: rows.filter(
					(f) => !(f.workspaceId === workspace && f.knowledgeBaseId === uid),
				),
				result: null,
			}),
		);
		// Eager cascade into chat: drop the KB id from any conversation's
		// RAG-grounding set so retrievals don't try to query a no-longer-
		// existing KB. No-op if no conversation referenced the KB.
		await this.mutate<"conversations", null>("conversations", (rows) => ({
			rows: rows.map((c) =>
				c.workspaceId === workspace && c.knowledgeBaseIds.includes(uid)
					? {
							...c,
							knowledgeBaseIds: Object.freeze(
								c.knowledgeBaseIds.filter((id) => id !== uid),
							),
						}
					: c,
			),
			result: null,
		}));
		return res;
	}

	/* ---------------- Knowledge filters ---------------- */

	async listKnowledgeFilters(
		workspace: string,
		knowledgeBase: string,
	): Promise<readonly KnowledgeFilterRecord[]> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const all = await this.readAll<KnowledgeFilterRecord>("knowledge-filters");
		return all.filter(
			(f) => f.workspaceId === workspace && f.knowledgeBaseId === knowledgeBase,
		);
	}

	async getKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<KnowledgeFilterRecord | null> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const all = await this.readAll<KnowledgeFilterRecord>("knowledge-filters");
		return (
			all.find(
				(f) =>
					f.workspaceId === workspace &&
					f.knowledgeBaseId === knowledgeBase &&
					f.knowledgeFilterId === uid,
			) ?? null
		);
	}

	async createKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		input: CreateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		return this.mutate<"knowledge-filters", KnowledgeFilterRecord>(
			"knowledge-filters",
			(rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(f) =>
							f.workspaceId === workspace &&
							f.knowledgeBaseId === knowledgeBase &&
							f.knowledgeFilterId === uid,
					)
				) {
					throw new ControlPlaneConflictError(
						`knowledge filter with uid '${uid}' already exists in knowledge base '${knowledgeBase}'`,
					);
				}
				const now = nowIso();
				const record: KnowledgeFilterRecord = {
					workspaceId: workspace,
					knowledgeBaseId: knowledgeBase,
					knowledgeFilterId: uid,
					name: input.name,
					description: input.description ?? null,
					filter: { ...input.filter },
					createdAt: now,
					updatedAt: now,
				};
				return { rows: [...rows, record], result: record };
			},
		);
	}

	async updateKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
		patch: UpdateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		return this.mutate<"knowledge-filters", KnowledgeFilterRecord>(
			"knowledge-filters",
			(rows) => {
				const idx = rows.findIndex(
					(f) =>
						f.workspaceId === workspace &&
						f.knowledgeBaseId === knowledgeBase &&
						f.knowledgeFilterId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("knowledge filter", uid);
				}
				const existing = rows[idx] as KnowledgeFilterRecord;
				const next: KnowledgeFilterRecord = {
					...existing,
					...(patch.name !== undefined && { name: patch.name }),
					...(patch.description !== undefined && {
						description: patch.description,
					}),
					...(patch.filter !== undefined && { filter: { ...patch.filter } }),
					updatedAt: nowIso(),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			},
		);
	}

	async deleteKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		return this.mutate<"knowledge-filters", { deleted: boolean }>(
			"knowledge-filters",
			(rows) => {
				const next = rows.filter(
					(f) =>
						!(
							f.workspaceId === workspace &&
							f.knowledgeBaseId === knowledgeBase &&
							f.knowledgeFilterId === uid
						),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
	}

	/* ---------------- RAG documents (KB-scoped) ---------------- */

	async listRagDocuments(
		workspace: string,
		knowledgeBase: string,
	): Promise<readonly RagDocumentRecord[]> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const all = await this.readAll<RagDocumentRecord>("rag-documents");
		return all.filter(
			(d) => d.workspaceId === workspace && d.knowledgeBaseId === knowledgeBase,
		);
	}

	async getRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<RagDocumentRecord | null> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const all = await this.readAll<RagDocumentRecord>("rag-documents");
		return (
			all.find(
				(d) =>
					d.workspaceId === workspace &&
					d.knowledgeBaseId === knowledgeBase &&
					d.documentId === uid,
			) ?? null
		);
	}

	async createRagDocument(
		workspace: string,
		knowledgeBase: string,
		input: CreateRagDocumentInput,
	): Promise<RagDocumentRecord> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		return this.mutate<"rag-documents", RagDocumentRecord>(
			"rag-documents",
			(rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(d) =>
							d.workspaceId === workspace &&
							d.knowledgeBaseId === knowledgeBase &&
							d.documentId === uid,
					)
				) {
					throw new ControlPlaneConflictError(
						`document with uid '${uid}' already exists in knowledge base '${knowledgeBase}'`,
					);
				}
				const record: RagDocumentRecord = {
					workspaceId: workspace,
					knowledgeBaseId: knowledgeBase,
					documentId: uid,
					sourceDocId: input.sourceDocId ?? null,
					sourceFilename: input.sourceFilename ?? null,
					fileType: input.fileType ?? null,
					fileSize: input.fileSize ?? null,
					contentHash: input.contentHash ?? null,
					chunkTotal: input.chunkTotal ?? null,
					ingestedAt: input.ingestedAt ?? null,
					updatedAt: nowIso(),
					status: input.status ?? "pending",
					errorMessage: input.errorMessage ?? null,
					metadata: { ...(input.metadata ?? {}) },
				};
				return { rows: [...rows, record], result: record };
			},
		);
	}

	async updateRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
		patch: UpdateRagDocumentInput,
	): Promise<RagDocumentRecord> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		return this.mutate<"rag-documents", RagDocumentRecord>(
			"rag-documents",
			(rows) => {
				const idx = rows.findIndex(
					(d) =>
						d.workspaceId === workspace &&
						d.knowledgeBaseId === knowledgeBase &&
						d.documentId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("document", uid);
				}
				const existing = rows[idx] as RagDocumentRecord;
				const next: RagDocumentRecord = {
					...existing,
					...(patch.sourceDocId !== undefined && {
						sourceDocId: patch.sourceDocId,
					}),
					...(patch.sourceFilename !== undefined && {
						sourceFilename: patch.sourceFilename,
					}),
					...(patch.fileType !== undefined && { fileType: patch.fileType }),
					...(patch.fileSize !== undefined && { fileSize: patch.fileSize }),
					...(patch.contentHash !== undefined && {
						contentHash: patch.contentHash,
					}),
					...(patch.chunkTotal !== undefined && {
						chunkTotal: patch.chunkTotal,
					}),
					...(patch.ingestedAt !== undefined && {
						ingestedAt: patch.ingestedAt,
					}),
					...(patch.status !== undefined && { status: patch.status }),
					...(patch.errorMessage !== undefined && {
						errorMessage: patch.errorMessage,
					}),
					...(patch.metadata !== undefined && {
						metadata: { ...patch.metadata },
					}),
					updatedAt: nowIso(),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			},
		);
	}

	async deleteRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		return this.mutate<"rag-documents", { deleted: boolean }>(
			"rag-documents",
			(rows) => {
				const next = rows.filter(
					(d) =>
						!(
							d.workspaceId === workspace &&
							d.knowledgeBaseId === knowledgeBase &&
							d.documentId === uid
						),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
	}

	/* ---------------- Chunking services ---------------- */

	async listChunkingServices(
		workspace: string,
	): Promise<readonly ChunkingServiceRecord[]> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<ChunkingServiceRecord>("chunking-services");
		return all.filter((s) => s.workspaceId === workspace);
	}

	async getChunkingService(
		workspace: string,
		uid: string,
	): Promise<ChunkingServiceRecord | null> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<ChunkingServiceRecord>("chunking-services");
		return (
			all.find(
				(s) => s.workspaceId === workspace && s.chunkingServiceId === uid,
			) ?? null
		);
	}

	async createChunkingService(
		workspace: string,
		input: CreateChunkingServiceInput,
	): Promise<ChunkingServiceRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"chunking-services", ChunkingServiceRecord>(
			"chunking-services",
			(rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(s) => s.workspaceId === workspace && s.chunkingServiceId === uid,
					)
				) {
					throw new ControlPlaneConflictError(
						`chunking service with uid '${uid}' already exists in workspace '${workspace}'`,
					);
				}
				const now = nowIso();
				const record: ChunkingServiceRecord = {
					workspaceId: workspace,
					chunkingServiceId: uid,
					name: input.name,
					description: input.description ?? null,
					status: input.status ?? DEFAULT_SERVICE_STATUS,
					engine: input.engine,
					engineVersion: input.engineVersion ?? null,
					strategy: input.strategy ?? null,
					maxChunkSize: input.maxChunkSize ?? null,
					minChunkSize: input.minChunkSize ?? null,
					chunkUnit: input.chunkUnit ?? null,
					overlapSize: input.overlapSize ?? null,
					overlapUnit: input.overlapUnit ?? null,
					preserveStructure: input.preserveStructure ?? null,
					language: input.language ?? null,
					endpointBaseUrl: input.endpointBaseUrl ?? null,
					endpointPath: input.endpointPath ?? null,
					requestTimeoutMs: input.requestTimeoutMs ?? null,
					authType: input.authType ?? DEFAULT_AUTH_TYPE,
					credentialRef: input.credentialRef ?? null,
					maxPayloadSizeKb: input.maxPayloadSizeKb ?? null,
					enableOcr: input.enableOcr ?? null,
					extractTables: input.extractTables ?? null,
					extractFigures: input.extractFigures ?? null,
					readingOrder: input.readingOrder ?? null,
					createdAt: now,
					updatedAt: now,
				};
				return { rows: [...rows, record], result: record };
			},
		);
	}

	async updateChunkingService(
		workspace: string,
		uid: string,
		patch: UpdateChunkingServiceInput,
	): Promise<ChunkingServiceRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"chunking-services", ChunkingServiceRecord>(
			"chunking-services",
			(rows) => {
				const idx = rows.findIndex(
					(s) => s.workspaceId === workspace && s.chunkingServiceId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("chunking service", uid);
				}
				const existing = rows[idx] as ChunkingServiceRecord;
				const next: ChunkingServiceRecord = applyPatch(existing, patch, {
					updatedAt: nowIso(),
				});
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			},
		);
	}

	async deleteChunkingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		await this.assertServiceNotReferenced(workspace, "chunkingServiceId", uid);
		return this.mutate<"chunking-services", { deleted: boolean }>(
			"chunking-services",
			(rows) => {
				const next = rows.filter(
					(s) => !(s.workspaceId === workspace && s.chunkingServiceId === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
	}

	/* ---------------- Embedding services ---------------- */

	async listEmbeddingServices(
		workspace: string,
	): Promise<readonly EmbeddingServiceRecord[]> {
		await this.assertWorkspace(workspace);
		const all =
			await this.readAll<EmbeddingServiceRecord>("embedding-services");
		return all.filter((s) => s.workspaceId === workspace);
	}

	async getEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<EmbeddingServiceRecord | null> {
		await this.assertWorkspace(workspace);
		const all =
			await this.readAll<EmbeddingServiceRecord>("embedding-services");
		return (
			all.find(
				(s) => s.workspaceId === workspace && s.embeddingServiceId === uid,
			) ?? null
		);
	}

	async createEmbeddingService(
		workspace: string,
		input: CreateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"embedding-services", EmbeddingServiceRecord>(
			"embedding-services",
			(rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(s) => s.workspaceId === workspace && s.embeddingServiceId === uid,
					)
				) {
					throw new ControlPlaneConflictError(
						`embedding service with uid '${uid}' already exists in workspace '${workspace}'`,
					);
				}
				const now = nowIso();
				const record: EmbeddingServiceRecord = {
					workspaceId: workspace,
					embeddingServiceId: uid,
					name: input.name,
					description: input.description ?? null,
					status: input.status ?? DEFAULT_SERVICE_STATUS,
					provider: input.provider,
					modelName: input.modelName,
					embeddingDimension: input.embeddingDimension,
					distanceMetric: input.distanceMetric ?? DEFAULT_DISTANCE_METRIC,
					endpointBaseUrl: input.endpointBaseUrl ?? null,
					endpointPath: input.endpointPath ?? null,
					requestTimeoutMs: input.requestTimeoutMs ?? null,
					maxBatchSize: input.maxBatchSize ?? null,
					maxInputTokens: input.maxInputTokens ?? null,
					authType: input.authType ?? DEFAULT_AUTH_TYPE,
					credentialRef: input.credentialRef ?? null,
					supportedLanguages: freezeStringSet(input.supportedLanguages),
					supportedContent: freezeStringSet(input.supportedContent),
					createdAt: now,
					updatedAt: now,
				};
				return { rows: [...rows, record], result: record };
			},
		);
	}

	async updateEmbeddingService(
		workspace: string,
		uid: string,
		patch: UpdateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"embedding-services", EmbeddingServiceRecord>(
			"embedding-services",
			(rows) => {
				const idx = rows.findIndex(
					(s) => s.workspaceId === workspace && s.embeddingServiceId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("embedding service", uid);
				}
				const existing = rows[idx] as EmbeddingServiceRecord;
				const merged = applyPatch(existing, patch, {
					updatedAt: nowIso(),
				});
				const next: EmbeddingServiceRecord = {
					...merged,
					...(patch.supportedLanguages !== undefined && {
						supportedLanguages: freezeStringSet(patch.supportedLanguages),
					}),
					...(patch.supportedContent !== undefined && {
						supportedContent: freezeStringSet(patch.supportedContent),
					}),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			},
		);
	}

	async deleteEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		await this.assertServiceNotReferenced(workspace, "embeddingServiceId", uid);
		return this.mutate<"embedding-services", { deleted: boolean }>(
			"embedding-services",
			(rows) => {
				const next = rows.filter(
					(s) => !(s.workspaceId === workspace && s.embeddingServiceId === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
	}

	/* ---------------- Reranking services ---------------- */

	async listRerankingServices(
		workspace: string,
	): Promise<readonly RerankingServiceRecord[]> {
		await this.assertWorkspace(workspace);
		const all =
			await this.readAll<RerankingServiceRecord>("reranking-services");
		return all.filter((s) => s.workspaceId === workspace);
	}

	async getRerankingService(
		workspace: string,
		uid: string,
	): Promise<RerankingServiceRecord | null> {
		await this.assertWorkspace(workspace);
		const all =
			await this.readAll<RerankingServiceRecord>("reranking-services");
		return (
			all.find(
				(s) => s.workspaceId === workspace && s.rerankingServiceId === uid,
			) ?? null
		);
	}

	async createRerankingService(
		workspace: string,
		input: CreateRerankingServiceInput,
	): Promise<RerankingServiceRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"reranking-services", RerankingServiceRecord>(
			"reranking-services",
			(rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(s) => s.workspaceId === workspace && s.rerankingServiceId === uid,
					)
				) {
					throw new ControlPlaneConflictError(
						`reranking service with uid '${uid}' already exists in workspace '${workspace}'`,
					);
				}
				const now = nowIso();
				const record: RerankingServiceRecord = {
					workspaceId: workspace,
					rerankingServiceId: uid,
					name: input.name,
					description: input.description ?? null,
					status: input.status ?? DEFAULT_SERVICE_STATUS,
					provider: input.provider,
					engine: input.engine ?? null,
					modelName: input.modelName,
					modelVersion: input.modelVersion ?? null,
					maxCandidates: input.maxCandidates ?? null,
					scoringStrategy: input.scoringStrategy ?? null,
					scoreNormalized: input.scoreNormalized ?? null,
					returnScores: input.returnScores ?? null,
					endpointBaseUrl: input.endpointBaseUrl ?? null,
					endpointPath: input.endpointPath ?? null,
					requestTimeoutMs: input.requestTimeoutMs ?? null,
					maxBatchSize: input.maxBatchSize ?? null,
					authType: input.authType ?? DEFAULT_AUTH_TYPE,
					credentialRef: input.credentialRef ?? null,
					supportedLanguages: freezeStringSet(input.supportedLanguages),
					supportedContent: freezeStringSet(input.supportedContent),
					createdAt: now,
					updatedAt: now,
				};
				return { rows: [...rows, record], result: record };
			},
		);
	}

	async updateRerankingService(
		workspace: string,
		uid: string,
		patch: UpdateRerankingServiceInput,
	): Promise<RerankingServiceRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"reranking-services", RerankingServiceRecord>(
			"reranking-services",
			(rows) => {
				const idx = rows.findIndex(
					(s) => s.workspaceId === workspace && s.rerankingServiceId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("reranking service", uid);
				}
				const existing = rows[idx] as RerankingServiceRecord;
				const merged = applyPatch(existing, patch, {
					updatedAt: nowIso(),
				});
				const next: RerankingServiceRecord = {
					...merged,
					...(patch.supportedLanguages !== undefined && {
						supportedLanguages: freezeStringSet(patch.supportedLanguages),
					}),
					...(patch.supportedContent !== undefined && {
						supportedContent: freezeStringSet(patch.supportedContent),
					}),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			},
		);
	}

	async deleteRerankingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		await this.assertServiceNotReferenced(workspace, "rerankingServiceId", uid);
		await this.assertAgentServiceNotReferenced(
			workspace,
			"rerankingServiceId",
			uid,
		);
		return this.mutate<"reranking-services", { deleted: boolean }>(
			"reranking-services",
			(rows) => {
				const next = rows.filter(
					(s) => !(s.workspaceId === workspace && s.rerankingServiceId === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
	}

	/* ---------------- LLM services ---------------- */

	async listLlmServices(
		workspace: string,
	): Promise<readonly LlmServiceRecord[]> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<LlmServiceRecord>("llm-services");
		return all.filter((s) => s.workspaceId === workspace);
	}

	async getLlmService(
		workspace: string,
		uid: string,
	): Promise<LlmServiceRecord | null> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<LlmServiceRecord>("llm-services");
		return (
			all.find((s) => s.workspaceId === workspace && s.llmServiceId === uid) ??
			null
		);
	}

	async createLlmService(
		workspace: string,
		input: CreateLlmServiceInput,
	): Promise<LlmServiceRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"llm-services", LlmServiceRecord>(
			"llm-services",
			(rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(s) => s.workspaceId === workspace && s.llmServiceId === uid,
					)
				) {
					throw new ControlPlaneConflictError(
						`llm service with uid '${uid}' already exists in workspace '${workspace}'`,
					);
				}
				const now = nowIso();
				const record: LlmServiceRecord = {
					workspaceId: workspace,
					llmServiceId: uid,
					name: input.name,
					description: input.description ?? null,
					status: input.status ?? DEFAULT_SERVICE_STATUS,
					provider: input.provider,
					engine: input.engine ?? null,
					modelName: input.modelName,
					modelVersion: input.modelVersion ?? null,
					contextWindowTokens: input.contextWindowTokens ?? null,
					maxOutputTokens: input.maxOutputTokens ?? null,
					temperatureMin: input.temperatureMin ?? null,
					temperatureMax: input.temperatureMax ?? null,
					supportsStreaming: input.supportsStreaming ?? null,
					supportsTools: input.supportsTools ?? null,
					endpointBaseUrl: input.endpointBaseUrl ?? null,
					endpointPath: input.endpointPath ?? null,
					requestTimeoutMs: input.requestTimeoutMs ?? null,
					maxBatchSize: input.maxBatchSize ?? null,
					authType: input.authType ?? DEFAULT_AUTH_TYPE,
					credentialRef: input.credentialRef ?? null,
					supportedLanguages: freezeStringSet(input.supportedLanguages),
					supportedContent: freezeStringSet(input.supportedContent),
					createdAt: now,
					updatedAt: now,
				};
				return { rows: [...rows, record], result: record };
			},
		);
	}

	async updateLlmService(
		workspace: string,
		uid: string,
		patch: UpdateLlmServiceInput,
	): Promise<LlmServiceRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"llm-services", LlmServiceRecord>(
			"llm-services",
			(rows) => {
				const idx = rows.findIndex(
					(s) => s.workspaceId === workspace && s.llmServiceId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("llm service", uid);
				}
				const existing = rows[idx] as LlmServiceRecord;
				const merged = applyPatch(existing, patch, {
					updatedAt: nowIso(),
				});
				const next: LlmServiceRecord = {
					...merged,
					...(patch.supportedLanguages !== undefined && {
						supportedLanguages: freezeStringSet(patch.supportedLanguages),
					}),
					...(patch.supportedContent !== undefined && {
						supportedContent: freezeStringSet(patch.supportedContent),
					}),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			},
		);
	}

	async deleteLlmService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		await this.assertAgentServiceNotReferenced(workspace, "llmServiceId", uid);
		return this.mutate<"llm-services", { deleted: boolean }>(
			"llm-services",
			(rows) => {
				const next = rows.filter(
					(s) => !(s.workspaceId === workspace && s.llmServiceId === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
	}

	/* ---------------- Agents ---------------- */

	async listAgents(workspaceId: string): Promise<readonly AgentRecord[]> {
		await this.assertWorkspace(workspaceId);
		const all = await this.readAll<AgentRecord>("agents");
		return all
			.filter((a) => a.workspaceId === workspaceId)
			.sort(byCreatedAtAscAgent);
	}

	async getAgent(
		workspaceId: string,
		agentId: string,
	): Promise<AgentRecord | null> {
		await this.assertWorkspace(workspaceId);
		const all = await this.readAll<AgentRecord>("agents");
		return (
			all.find((a) => a.workspaceId === workspaceId && a.agentId === agentId) ??
			null
		);
	}

	async createAgent(
		workspaceId: string,
		input: CreateAgentInput,
	): Promise<AgentRecord> {
		await this.assertWorkspace(workspaceId);
		if (input.llmServiceId != null) {
			await this.assertLlmService(workspaceId, input.llmServiceId);
		}
		if (input.rerankingServiceId != null) {
			await this.assertRerankingService(workspaceId, input.rerankingServiceId);
		}
		return this.mutate<"agents", AgentRecord>("agents", (rows) => {
			const agentId = input.agentId ?? randomUUID();
			if (
				rows.some((a) => a.workspaceId === workspaceId && a.agentId === agentId)
			) {
				throw new ControlPlaneConflictError(
					`agent with id '${agentId}' already exists`,
				);
			}
			const now = nowIso();
			const record: AgentRecord = {
				workspaceId,
				agentId,
				name: input.name,
				description: input.description ?? null,
				systemPrompt: input.systemPrompt ?? null,
				userPrompt: input.userPrompt ?? null,
				toolIds: freezeStringSet([]),
				llmServiceId: input.llmServiceId ?? null,
				ragEnabled: input.ragEnabled ?? false,
				knowledgeBaseIds: freezeStringSet(input.knowledgeBaseIds),
				ragMaxResults: input.ragMaxResults ?? null,
				ragMinScore: input.ragMinScore ?? null,
				rerankEnabled: input.rerankEnabled ?? false,
				rerankingServiceId: input.rerankingServiceId ?? null,
				rerankMaxResults: input.rerankMaxResults ?? null,
				createdAt: now,
				updatedAt: now,
			};
			return { rows: [...rows, record], result: record };
		});
	}

	async updateAgent(
		workspaceId: string,
		agentId: string,
		patch: UpdateAgentInput,
	): Promise<AgentRecord> {
		await this.assertWorkspace(workspaceId);
		if (patch.llmServiceId != null) {
			await this.assertLlmService(workspaceId, patch.llmServiceId);
		}
		if (patch.rerankingServiceId != null) {
			await this.assertRerankingService(workspaceId, patch.rerankingServiceId);
		}
		return this.mutate<"agents", AgentRecord>("agents", (rows) => {
			const idx = rows.findIndex(
				(a) => a.workspaceId === workspaceId && a.agentId === agentId,
			);
			if (idx < 0) {
				throw new ControlPlaneNotFoundError("agent", agentId);
			}
			const existing = rows[idx] as AgentRecord;
			const next: AgentRecord = {
				...existing,
				...(patch.name !== undefined && { name: patch.name }),
				...(patch.description !== undefined && {
					description: patch.description,
				}),
				...(patch.systemPrompt !== undefined && {
					systemPrompt: patch.systemPrompt,
				}),
				...(patch.userPrompt !== undefined && { userPrompt: patch.userPrompt }),
				...(patch.llmServiceId !== undefined && {
					llmServiceId: patch.llmServiceId,
				}),
				...(patch.knowledgeBaseIds !== undefined && {
					knowledgeBaseIds: freezeStringSet(patch.knowledgeBaseIds),
				}),
				...(patch.ragEnabled !== undefined && { ragEnabled: patch.ragEnabled }),
				...(patch.ragMaxResults !== undefined && {
					ragMaxResults: patch.ragMaxResults,
				}),
				...(patch.ragMinScore !== undefined && {
					ragMinScore: patch.ragMinScore,
				}),
				...(patch.rerankEnabled !== undefined && {
					rerankEnabled: patch.rerankEnabled,
				}),
				...(patch.rerankingServiceId !== undefined && {
					rerankingServiceId: patch.rerankingServiceId,
				}),
				...(patch.rerankMaxResults !== undefined && {
					rerankMaxResults: patch.rerankMaxResults,
				}),
				updatedAt: nowIso(),
			};
			const nextRows = [...rows];
			nextRows[idx] = next;
			return { rows: nextRows, result: next };
		});
	}

	async deleteAgent(
		workspaceId: string,
		agentId: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspaceId);
		const res = await this.mutate<"agents", { deleted: boolean }>(
			"agents",
			(rows) => {
				const next = rows.filter(
					(a) => !(a.workspaceId === workspaceId && a.agentId === agentId),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
		if (res.deleted) {
			// Cascade: drop the agent's conversations and any messages
			// belonging to those conversations.
			const droppedConversationIds = new Set<string>();
			await this.mutate<"conversations", null>("conversations", (rows) => ({
				rows: rows.filter((c) => {
					const drop = c.workspaceId === workspaceId && c.agentId === agentId;
					if (drop) droppedConversationIds.add(c.conversationId);
					return !drop;
				}),
				result: null,
			}));
			if (droppedConversationIds.size > 0) {
				await this.mutate<"messages", null>("messages", (rows) => ({
					rows: rows.filter(
						(m) =>
							!(
								m.workspaceId === workspaceId &&
								droppedConversationIds.has(m.conversationId)
							),
					),
					result: null,
				}));
			}
		}
		return res;
	}

	/* ---------------- Conversations (agent-scoped) ---------------- */

	async listConversations(
		workspaceId: string,
		agentId: string,
	): Promise<readonly ConversationRecord[]> {
		await this.assertWorkspace(workspaceId);
		const all = await this.readAll<ConversationRecord>("conversations");
		return all
			.filter((c) => c.workspaceId === workspaceId && c.agentId === agentId)
			.sort(byCreatedAtDescConv);
	}

	async getConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<ConversationRecord | null> {
		await this.assertWorkspace(workspaceId);
		const all = await this.readAll<ConversationRecord>("conversations");
		return (
			all.find(
				(c) =>
					c.workspaceId === workspaceId &&
					c.agentId === agentId &&
					c.conversationId === conversationId,
			) ?? null
		);
	}

	async createConversation(
		workspaceId: string,
		agentId: string,
		input: CreateConversationInput,
	): Promise<ConversationRecord> {
		await this.assertAgent(workspaceId, agentId);
		return this.mutate<"conversations", ConversationRecord>(
			"conversations",
			(rows) => {
				const conversationId = input.conversationId ?? randomUUID();
				if (
					rows.some(
						(c) =>
							c.workspaceId === workspaceId &&
							c.agentId === agentId &&
							c.conversationId === conversationId,
					)
				) {
					throw new ControlPlaneConflictError(
						`conversation with id '${conversationId}' already exists`,
					);
				}
				const record: ConversationRecord = {
					workspaceId,
					agentId,
					conversationId,
					createdAt: nowIso(),
					title: input.title ?? null,
					knowledgeBaseIds: freezeStringSet(input.knowledgeBaseIds),
				};
				return { rows: [...rows, record], result: record };
			},
		);
	}

	async updateConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
		patch: UpdateConversationInput,
	): Promise<ConversationRecord> {
		await this.assertWorkspace(workspaceId);
		return this.mutate<"conversations", ConversationRecord>(
			"conversations",
			(rows) => {
				const idx = rows.findIndex(
					(c) =>
						c.workspaceId === workspaceId &&
						c.agentId === agentId &&
						c.conversationId === conversationId,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("conversation", conversationId);
				}
				const existing = rows[idx] as ConversationRecord;
				const next: ConversationRecord = {
					...existing,
					...(patch.title !== undefined && { title: patch.title }),
					...(patch.knowledgeBaseIds !== undefined && {
						knowledgeBaseIds: freezeStringSet(patch.knowledgeBaseIds),
					}),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			},
		);
	}

	async deleteConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspaceId);
		const res = await this.mutate<"conversations", { deleted: boolean }>(
			"conversations",
			(rows) => {
				const next = rows.filter(
					(c) =>
						!(
							c.workspaceId === workspaceId &&
							c.agentId === agentId &&
							c.conversationId === conversationId
						),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
		if (res.deleted) {
			await this.mutate<"messages", null>("messages", (rows) => ({
				rows: rows.filter(
					(m) =>
						!(
							m.workspaceId === workspaceId &&
							m.conversationId === conversationId
						),
				),
				result: null,
			}));
		}
		return res;
	}

	/* ---------------- Chat messages ---------------- */

	async listChatMessages(
		workspaceId: string,
		chatId: string,
	): Promise<readonly MessageRecord[]> {
		await this.assertChat(workspaceId, chatId);
		const all = await this.readAll<MessageRecord>("messages");
		return all
			.filter(
				(m) => m.workspaceId === workspaceId && m.conversationId === chatId,
			)
			.sort(byMessageTsAsc);
	}

	async appendChatMessage(
		workspaceId: string,
		chatId: string,
		input: AppendChatMessageInput,
	): Promise<MessageRecord> {
		await this.assertChat(workspaceId, chatId);
		return this.mutate<"messages", MessageRecord>("messages", (rows) => {
			const messageId = input.messageId ?? randomUUID();
			if (
				rows.some(
					(m) =>
						m.workspaceId === workspaceId &&
						m.conversationId === chatId &&
						m.messageId === messageId,
				)
			) {
				throw new ControlPlaneConflictError(
					`message with id '${messageId}' already exists`,
				);
			}
			const record: MessageRecord = {
				workspaceId,
				conversationId: chatId,
				messageTs: input.messageTs ?? nowIso(),
				messageId,
				role: input.role,
				authorId: input.authorId ?? null,
				content: input.content ?? null,
				toolId: input.toolId ?? null,
				toolCallPayload: input.toolCallPayload
					? Object.freeze({ ...input.toolCallPayload })
					: null,
				toolResponse: input.toolResponse
					? Object.freeze({ ...input.toolResponse })
					: null,
				tokenCount: input.tokenCount ?? null,
				metadata: Object.freeze({ ...(input.metadata ?? {}) }),
			};
			return { rows: [...rows, record], result: record };
		});
	}

	async updateChatMessage(
		workspaceId: string,
		chatId: string,
		messageId: string,
		patch: UpdateChatMessageInput,
	): Promise<MessageRecord> {
		await this.assertChat(workspaceId, chatId);
		return this.mutate<"messages", MessageRecord>("messages", (rows) => {
			const idx = rows.findIndex(
				(m) =>
					m.workspaceId === workspaceId &&
					m.conversationId === chatId &&
					m.messageId === messageId,
			);
			if (idx < 0) {
				throw new ControlPlaneNotFoundError("chat message", messageId);
			}
			const existing = rows[idx] as MessageRecord;
			const next: MessageRecord = {
				...existing,
				...(patch.content !== undefined && { content: patch.content }),
				...(patch.tokenCount !== undefined && { tokenCount: patch.tokenCount }),
				...(patch.metadata !== undefined && {
					metadata: mergeMessageMetadata(existing.metadata, patch.metadata),
				}),
			};
			const nextRows = [...rows];
			nextRows[idx] = next;
			return { rows: nextRows, result: next };
		});
	}

	/**
	 * Resolve a conversation across any agent in the workspace. Messages
	 * are keyed by (workspace, conversation), not (workspace, agent,
	 * conversation), so chat message append / list / update don't need
	 * an agent argument.
	 */
	private async assertChat(workspaceId: string, chatId: string): Promise<void> {
		await this.assertWorkspace(workspaceId);
		const all = await this.readAll<ConversationRecord>("conversations");
		const exists = all.some(
			(c) => c.workspaceId === workspaceId && c.conversationId === chatId,
		);
		if (!exists) {
			throw new ControlPlaneNotFoundError("chat", chatId);
		}
	}

	private async assertAgent(
		workspaceId: string,
		agentId: string,
	): Promise<void> {
		const agent = await this.getAgent(workspaceId, agentId);
		if (!agent) {
			throw new ControlPlaneNotFoundError("agent", agentId);
		}
	}

	/* ---------------- Plumbing ---------------- */

	private async readAll<T>(table: Table): Promise<T[]> {
		const path = join(this.root, TABLE_FILES[table]);
		try {
			const raw = await readFile(path, "utf8");
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				throw new Error(`control-plane file '${path}' is not a JSON array`);
			}
			return parsed as T[];
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw err;
		}
	}

	private async writeAll<T>(table: Table, rows: readonly T[]): Promise<void> {
		await mkdir(this.root, { recursive: true });
		const finalPath = join(this.root, TABLE_FILES[table]);
		const tmpPath = `${finalPath}.${randomUUID()}.tmp`;
		await writeFile(tmpPath, JSON.stringify(rows, null, 2), "utf8");
		await rename(tmpPath, finalPath);
	}

	private async mutate<K extends Table, R>(
		table: K,
		fn: (rows: ReadonlyArray<TableRow<K>>) => {
			rows: readonly TableRow<K>[];
			result: R;
		},
	): Promise<R> {
		return this.mutexes[table].run(async () => {
			const rows = await this.readAll<TableRow<K>>(table);
			const { rows: nextRows, result } = fn(rows);
			await this.writeAll(table, nextRows);
			return result;
		});
	}

	private async assertWorkspace(uid: string): Promise<void> {
		const ws = await this.getWorkspace(uid);
		if (!ws) {
			throw new ControlPlaneNotFoundError("workspace", uid);
		}
	}

	private async assertKnowledgeBase(
		workspace: string,
		knowledgeBase: string,
	): Promise<void> {
		await this.assertWorkspace(workspace);
		const kb = await this.getKnowledgeBase(workspace, knowledgeBase);
		if (!kb) {
			throw new ControlPlaneNotFoundError("knowledge base", knowledgeBase);
		}
	}

	private async assertChunkingService(
		workspace: string,
		uid: string,
	): Promise<void> {
		const found = await this.getChunkingService(workspace, uid);
		if (!found) {
			throw new ControlPlaneNotFoundError("chunking service", uid);
		}
	}

	private async assertEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<void> {
		const found = await this.getEmbeddingService(workspace, uid);
		if (!found) {
			throw new ControlPlaneNotFoundError("embedding service", uid);
		}
	}

	private async assertRerankingService(
		workspace: string,
		uid: string,
	): Promise<void> {
		const found = await this.getRerankingService(workspace, uid);
		if (!found) {
			throw new ControlPlaneNotFoundError("reranking service", uid);
		}
	}

	private async assertLlmService(
		workspace: string,
		uid: string,
	): Promise<void> {
		const found = await this.getLlmService(workspace, uid);
		if (!found) {
			throw new ControlPlaneNotFoundError("llm service", uid);
		}
	}

	private async assertServiceNotReferenced(
		workspace: string,
		field: "embeddingServiceId" | "chunkingServiceId" | "rerankingServiceId",
		serviceUid: string,
	): Promise<void> {
		const kbs = await this.readAll<KnowledgeBaseRecord>("knowledge-bases");
		const ref = kbs.find(
			(kb) => kb.workspaceId === workspace && kb[field] === serviceUid,
		);
		if (ref) {
			throw new ControlPlaneConflictError(
				`service '${serviceUid}' is referenced by knowledge base '${ref.knowledgeBaseId}' (${field})`,
			);
		}
	}

	private async assertAgentServiceNotReferenced(
		workspace: string,
		field: "llmServiceId" | "rerankingServiceId",
		serviceUid: string,
	): Promise<void> {
		const agents = await this.readAll<AgentRecord>("agents");
		const ref = agents.find(
			(agent) => agent.workspaceId === workspace && agent[field] === serviceUid,
		);
		if (ref) {
			throw new ControlPlaneConflictError(
				`service '${serviceUid}' is referenced by agent '${ref.agentId}' (${field})`,
			);
		}
	}
}

/**
 * Mechanical "spread defined patch fields onto existing record" helper.
 * Used by the chunking / embedding / reranking service updaters where
 * the patch shape is `Partial<Omit<Create*Input, "uid">>` — every
 * defined property is a valid record field and goes through verbatim.
 *
 * Set-typed columns are not handled here because their input form
 * (`readonly string[] | ReadonlySet<string>`) doesn't match the record
 * form (`ReadonlySet<string>`); the call site overrides them after.
 */
function applyPatch<TRecord extends object, TPatch extends object>(
	existing: TRecord,
	patch: TPatch,
	overrides: Partial<TRecord>,
): TRecord {
	const next = { ...existing } as Record<string, unknown>;
	for (const [k, v] of Object.entries(patch)) {
		if (v !== undefined) next[k] = v;
	}
	return { ...(next as TRecord), ...overrides };
}

type TableRow<K extends Table> = K extends "workspaces"
	? WorkspaceRecord
	: K extends "api-keys"
		? ApiKeyRecord
		: K extends "knowledge-bases"
			? KnowledgeBaseRecord
			: K extends "knowledge-filters"
				? KnowledgeFilterRecord
				: K extends "chunking-services"
					? ChunkingServiceRecord
					: K extends "embedding-services"
						? EmbeddingServiceRecord
						: K extends "reranking-services"
							? RerankingServiceRecord
							: K extends "llm-services"
								? LlmServiceRecord
								: K extends "rag-documents"
									? RagDocumentRecord
									: K extends "agents"
										? AgentRecord
										: K extends "conversations"
											? ConversationRecord
											: K extends "messages"
												? MessageRecord
												: never;
