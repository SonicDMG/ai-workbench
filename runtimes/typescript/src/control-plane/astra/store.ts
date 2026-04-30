/**
 * {@link ../store.ControlPlaneStore} backed by Astra Data API Tables.
 *
 * Holds no state of its own — every operation is a `findOne`,
 * `insertOne`, `updateOne`, or `deleteOne` against the `wb_*` tables
 * declared in {@link ../../astra-client/table-definitions.ts}.
 *
 * Error mapping contract:
 *   - `findOne` → null  → {@link ControlPlaneNotFoundError} on the
 *     relevant method.
 *   - Insert of a PK that already exists → {@link ControlPlaneConflictError}.
 *     (Astra's insert into Tables is upsert-by-default, so we check
 *     existence first.)
 *
 * Cascade semantics:
 *   - `deleteWorkspace` → `deleteMany` on every dependent partition.
 *     Accepted: partial failure across partitions (no cross-partition
 *     transaction).
 *   - `deleteKnowledgeBase` → `deleteMany` on rag-documents scoped by
 *     (workspace, knowledge_base_id) and the by-status secondary index.
 */

import { randomUUID } from "node:crypto";
import {
	agentFromRow,
	agentToRow,
	apiKeyFromRow,
	apiKeyToRow,
	chunkingServiceFromRow,
	chunkingServiceToRow,
	conversationFromRow,
	conversationToRow,
	embeddingServiceFromRow,
	embeddingServiceToRow,
	knowledgeBaseFromRow,
	knowledgeBaseToRow,
	knowledgeFilterFromRow,
	knowledgeFilterToRow,
	llmServiceFromRow,
	llmServiceToRow,
	messageFromRow,
	messageToRow,
	ragDocumentByHashToRow,
	ragDocumentByStatusToRow,
	ragDocumentFromRow,
	ragDocumentToRow,
	rerankingServiceFromRow,
	rerankingServiceToRow,
	workspaceFromRow,
	workspaceToRow,
} from "../../astra-client/converters.js";
import type { TablesBundle } from "../../astra-client/tables.js";
import {
	byCreatedAtThenId,
	byCreatedAtThenKeyId,
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

function freezeStringSet(
	value: ReadonlySet<string> | readonly string[] | undefined,
): readonly string[] {
	return Object.freeze([...new Set(value ?? [])].sort());
}

/**
 * Newest-first sort for chat conversations. Mirrors the table's
 * `created_at DESC` cluster ordering so list output is deterministic
 * even when the underlying transport (real Astra vs the test fake)
 * doesn't preserve cluster order.
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
 * Oldest-first sort for agent rows. Tie-break on agent_id for total order.
 */
function byCreatedAtAscAgent(a: AgentRecord, b: AgentRecord): number {
	if (a.createdAt < b.createdAt) return -1;
	if (a.createdAt > b.createdAt) return 1;
	if (a.agentId < b.agentId) return -1;
	if (a.agentId > b.agentId) return 1;
	return 0;
}

/**
 * Oldest-first sort for chat messages. Mirrors `message_ts ASC`.
 */
function byMessageTsAsc(a: MessageRecord, b: MessageRecord): number {
	if (a.messageTs < b.messageTs) return -1;
	if (a.messageTs > b.messageTs) return 1;
	if (a.messageId < b.messageId) return -1;
	if (a.messageId > b.messageId) return 1;
	return 0;
}

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

export class AstraControlPlaneStore implements ControlPlaneStore {
	constructor(private readonly tables: TablesBundle) {}

	/* ---------------- Workspaces ---------------- */

	async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
		const rows = await this.tables.workspaces.find({}).toArray();
		return rows.map(workspaceFromRow).sort(byCreatedAtThenId);
	}

	async getWorkspace(uid: string): Promise<WorkspaceRecord | null> {
		const row = await this.tables.workspaces.findOne({ uid });
		return row ? workspaceFromRow(row) : null;
	}

	async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
		const uid = input.uid ?? randomUUID();
		if (await this.tables.workspaces.findOne({ uid })) {
			throw new ControlPlaneConflictError(
				`workspace with id '${uid}' already exists`,
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
		await this.tables.workspaces.insertOne(workspaceToRow(record));
		return record;
	}

	async updateWorkspace(
		uid: string,
		patch: UpdateWorkspaceInput,
	): Promise<WorkspaceRecord> {
		const existing = await this.tables.workspaces.findOne({ uid });
		if (!existing) throw new ControlPlaneNotFoundError("workspace", uid);
		const base = workspaceFromRow(existing);
		const next: WorkspaceRecord = {
			...base,
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.url !== undefined && { url: patch.url }),
			...(patch.credentials !== undefined && {
				credentials: { ...patch.credentials },
			}),
			...(patch.keyspace !== undefined && { keyspace: patch.keyspace }),
			updatedAt: nowIso(),
		};
		const nextRow = workspaceToRow(next);
		const { uid: _pk, ...fields } = nextRow;
		await this.tables.workspaces.updateOne({ uid }, { $set: fields });
		return next;
	}

	async deleteWorkspace(uid: string): Promise<{ deleted: boolean }> {
		const existing = await this.tables.workspaces.findOne({ uid });
		if (!existing) return { deleted: false };
		// Tear down the prefix-lookup entries before the owning table so a
		// concurrent verify can't hit a lookup pointing at a just-deleted
		// key row.
		const keyRows = await this.tables.apiKeys
			.find({ workspace: uid })
			.toArray();
		for (const row of keyRows) {
			await this.tables.apiKeyLookup.deleteOne({ prefix: row.prefix });
		}
		await this.tables.workspaces.deleteOne({ uid });
		await Promise.all([
			this.tables.apiKeys.deleteMany({ workspace: uid }),
			this.tables.knowledgeBases.deleteMany({ workspace_id: uid }),
			this.tables.knowledgeFilters.deleteMany({ workspace_id: uid }),
			this.tables.chunkingServices.deleteMany({ workspace_id: uid }),
			this.tables.embeddingServices.deleteMany({ workspace_id: uid }),
			this.tables.rerankingServices.deleteMany({ workspace_id: uid }),
			this.tables.llmServices.deleteMany({ workspace_id: uid }),
			this.tables.ragDocuments.deleteMany({ workspace_id: uid }),
			this.tables.ragDocumentsByStatus.deleteMany({ workspace_id: uid }),
			// Chat cascade: agents → conversations → messages.
			this.tables.agents.deleteMany({ workspace_id: uid }),
			this.tables.conversations.deleteMany({ workspace_id: uid }),
			this.tables.messages.deleteMany({ workspace_id: uid }),
		]);
		return { deleted: true };
	}

	/* ---------------- API keys ---------------- */

	async listApiKeys(workspace: string): Promise<readonly ApiKeyRecord[]> {
		await this.assertWorkspace(workspace);
		const rows = await this.tables.apiKeys.find({ workspace }).toArray();
		return rows.map(apiKeyFromRow).sort(byCreatedAtThenKeyId);
	}

	async getApiKey(
		workspace: string,
		keyId: string,
	): Promise<ApiKeyRecord | null> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.apiKeys.findOne({
			workspace,
			key_id: keyId,
		});
		return row ? apiKeyFromRow(row) : null;
	}

	async persistApiKey(
		workspace: string,
		input: PersistApiKeyInput,
	): Promise<ApiKeyRecord> {
		await this.assertWorkspace(workspace);
		if (await this.tables.apiKeyLookup.findOne({ prefix: input.prefix })) {
			throw new ControlPlaneConflictError(
				`api key with prefix '${input.prefix}' already exists`,
			);
		}
		if (await this.tables.apiKeys.findOne({ workspace, key_id: input.keyId })) {
			throw new ControlPlaneConflictError(
				`api key with id '${input.keyId}' already exists in workspace '${workspace}'`,
			);
		}
		const now = nowIso();
		const record: ApiKeyRecord = {
			workspace,
			keyId: input.keyId,
			prefix: input.prefix,
			hash: input.hash,
			label: input.label,
			createdAt: now,
			lastUsedAt: null,
			revokedAt: null,
			expiresAt: input.expiresAt ?? null,
		};
		// Insert the row first, then the lookup entry. A crash after the
		// primary insert and before the lookup leaves an unreachable key
		// — inconvenient but not unsafe (the bad record can't be used to
		// auth since the verifier goes through the lookup).
		await this.tables.apiKeys.insertOne(apiKeyToRow(record));
		await this.tables.apiKeyLookup.insertOne({
			prefix: input.prefix,
			workspace,
			key_id: input.keyId,
		});
		return record;
	}

	async revokeApiKey(
		workspace: string,
		keyId: string,
	): Promise<{ revoked: boolean }> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.apiKeys.findOne({
			workspace,
			key_id: keyId,
		});
		if (!row) return { revoked: false };
		if (row.revoked_at !== null) return { revoked: false };
		await this.tables.apiKeys.updateOne(
			{ workspace, key_id: keyId },
			{ $set: { revoked_at: nowIso() } },
		);
		return { revoked: true };
	}

	async findApiKeyByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
		const lookup = await this.tables.apiKeyLookup.findOne({ prefix });
		if (!lookup) return null;
		const row = await this.tables.apiKeys.findOne({
			workspace: lookup.workspace,
			key_id: lookup.key_id,
		});
		return row ? apiKeyFromRow(row) : null;
	}

	async touchApiKey(workspace: string, keyId: string): Promise<void> {
		await this.tables.apiKeys.updateOne(
			{ workspace, key_id: keyId },
			{ $set: { last_used_at: nowIso() } },
		);
	}

	/* ---------------- Knowledge bases (issue #98) ---------------- */

	async listKnowledgeBases(
		workspace: string,
	): Promise<readonly KnowledgeBaseRecord[]> {
		await this.assertWorkspace(workspace);
		const rows = await this.tables.knowledgeBases
			.find({ workspace_id: workspace })
			.toArray();
		return rows.map(knowledgeBaseFromRow);
	}

	async getKnowledgeBase(
		workspace: string,
		uid: string,
	): Promise<KnowledgeBaseRecord | null> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.knowledgeBases.findOne({
			workspace_id: workspace,
			knowledge_base_id: uid,
		});
		return row ? knowledgeBaseFromRow(row) : null;
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
		const uid = input.uid ?? randomUUID();
		if (
			await this.tables.knowledgeBases.findOne({
				workspace_id: workspace,
				knowledge_base_id: uid,
			})
		) {
			throw new ControlPlaneConflictError(
				`knowledge base with id '${uid}' already exists in workspace '${workspace}'`,
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
			vectorCollection: input.vectorCollection ?? defaultVectorCollection(uid),
			owned: input.owned ?? true,
			lexical: input.lexical ?? DEFAULT_LEXICAL,
			createdAt: now,
			updatedAt: now,
		};
		await this.tables.knowledgeBases.insertOne(knowledgeBaseToRow(record));
		return record;
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
		const existing = await this.tables.knowledgeBases.findOne({
			workspace_id: workspace,
			knowledge_base_id: uid,
		});
		if (!existing) throw new ControlPlaneNotFoundError("knowledge base", uid);
		const base = knowledgeBaseFromRow(existing);
		const next: KnowledgeBaseRecord = {
			...base,
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
		const nextRow = knowledgeBaseToRow(next);
		const { workspace_id: _w, knowledge_base_id: _kb, ...fields } = nextRow;
		await this.tables.knowledgeBases.updateOne(
			{ workspace_id: workspace, knowledge_base_id: uid },
			{ $set: fields },
		);
		return next;
	}

	async deleteKnowledgeBase(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		const existing = await this.tables.knowledgeBases.findOne({
			workspace_id: workspace,
			knowledge_base_id: uid,
		});
		if (!existing) return { deleted: false };
		await this.tables.knowledgeBases.deleteOne({
			workspace_id: workspace,
			knowledge_base_id: uid,
		});
		// Cascade RAG document rows + secondary indexes. Underlying vector
		// collection cleanup is the caller's responsibility (KB delete
		// route handles it).
		await Promise.all([
			this.tables.ragDocuments.deleteMany({
				workspace_id: workspace,
				knowledge_base_id: uid,
			}),
			this.tables.ragDocumentsByStatus.deleteMany({
				workspace_id: workspace,
				knowledge_base_id: uid,
			}),
			this.tables.knowledgeFilters.deleteMany({
				workspace_id: workspace,
				knowledge_base_id: uid,
			}),
		]);
		// Eager cascade into chat: rewrite any conversation row whose
		// `knowledge_base_ids` set contained the deleted KB. We can't
		// do this server-side (no SET-element delete on the wire), so
		// we read back the workspace's conversations, filter, and
		// patch each affected row. v0 expects O(handful) chats per
		// workspace; if that grows we'll add a `_by_kb` secondary
		// index on conversations.
		const convRows = await this.tables.conversations
			.find({ workspace_id: workspace })
			.toArray();
		for (const row of convRows) {
			const kbs = row.knowledge_base_ids;
			if (!kbs?.has(uid)) continue;
			const next = new Set(kbs);
			next.delete(uid);
			await this.tables.conversations.updateOne(
				{
					workspace_id: workspace,
					agent_id: row.agent_id,
					created_at: row.created_at,
					conversation_id: row.conversation_id,
				},
				{ $set: { knowledge_base_ids: next.size > 0 ? next : null } },
			);
		}
		return { deleted: true };
	}

	/* ---------------- Knowledge filters ---------------- */

	async listKnowledgeFilters(
		workspace: string,
		knowledgeBase: string,
	): Promise<readonly KnowledgeFilterRecord[]> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const rows = await this.tables.knowledgeFilters
			.find({ workspace_id: workspace, knowledge_base_id: knowledgeBase })
			.toArray();
		return rows.map(knowledgeFilterFromRow);
	}

	async getKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<KnowledgeFilterRecord | null> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const row = await this.tables.knowledgeFilters.findOne({
			workspace_id: workspace,
			knowledge_base_id: knowledgeBase,
			knowledge_filter_id: uid,
		});
		return row ? knowledgeFilterFromRow(row) : null;
	}

	async createKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		input: CreateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const uid = input.uid ?? randomUUID();
		if (
			await this.tables.knowledgeFilters.findOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				knowledge_filter_id: uid,
			})
		) {
			throw new ControlPlaneConflictError(
				`knowledge filter with id '${uid}' already exists in knowledge base '${knowledgeBase}'`,
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
		await this.tables.knowledgeFilters.insertOne(knowledgeFilterToRow(record));
		return record;
	}

	async updateKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
		patch: UpdateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const existing = await this.tables.knowledgeFilters.findOne({
			workspace_id: workspace,
			knowledge_base_id: knowledgeBase,
			knowledge_filter_id: uid,
		});
		if (!existing) throw new ControlPlaneNotFoundError("knowledge filter", uid);
		const base = knowledgeFilterFromRow(existing);
		const next: KnowledgeFilterRecord = {
			...base,
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.description !== undefined && {
				description: patch.description,
			}),
			...(patch.filter !== undefined && { filter: { ...patch.filter } }),
			updatedAt: nowIso(),
		};
		const nextRow = knowledgeFilterToRow(next);
		const {
			workspace_id: _w,
			knowledge_base_id: _kb,
			knowledge_filter_id: _kf,
			...fields
		} = nextRow;
		await this.tables.knowledgeFilters.updateOne(
			{
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				knowledge_filter_id: uid,
			},
			{ $set: fields },
		);
		return next;
	}

	async deleteKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const existing = await this.tables.knowledgeFilters.findOne({
			workspace_id: workspace,
			knowledge_base_id: knowledgeBase,
			knowledge_filter_id: uid,
		});
		if (!existing) return { deleted: false };
		await this.tables.knowledgeFilters.deleteOne({
			workspace_id: workspace,
			knowledge_base_id: knowledgeBase,
			knowledge_filter_id: uid,
		});
		return { deleted: true };
	}

	/* ---------------- RAG documents (KB-scoped) ---------------- */

	async listRagDocuments(
		workspace: string,
		knowledgeBase: string,
	): Promise<readonly RagDocumentRecord[]> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const rows = await this.tables.ragDocuments
			.find({ workspace_id: workspace, knowledge_base_id: knowledgeBase })
			.toArray();
		return rows.map(ragDocumentFromRow);
	}

	async getRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<RagDocumentRecord | null> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const row = await this.tables.ragDocuments.findOne({
			workspace_id: workspace,
			knowledge_base_id: knowledgeBase,
			document_id: uid,
		});
		return row ? ragDocumentFromRow(row) : null;
	}

	async createRagDocument(
		workspace: string,
		knowledgeBase: string,
		input: CreateRagDocumentInput,
	): Promise<RagDocumentRecord> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const uid = input.uid ?? randomUUID();
		if (
			await this.tables.ragDocuments.findOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				document_id: uid,
			})
		) {
			throw new ControlPlaneConflictError(
				`document with id '${uid}' already exists in knowledge base '${knowledgeBase}'`,
			);
		}
		const now = nowIso();
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
			updatedAt: now,
			status: input.status ?? "pending",
			errorMessage: input.errorMessage ?? null,
			metadata: { ...(input.metadata ?? {}) },
		};
		await this.tables.ragDocuments.insertOne(ragDocumentToRow(record));
		await this.writeRagStatusIndex(record);
		if (record.contentHash) {
			await this.tables.ragDocumentsByHash.insertOne(
				ragDocumentByHashToRow({
					contentHash: record.contentHash,
					workspaceId: record.workspaceId,
					knowledgeBaseId: record.knowledgeBaseId,
					documentId: record.documentId,
				}),
			);
		}
		return record;
	}

	async updateRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
		patch: UpdateRagDocumentInput,
	): Promise<RagDocumentRecord> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const existing = await this.tables.ragDocuments.findOne({
			workspace_id: workspace,
			knowledge_base_id: knowledgeBase,
			document_id: uid,
		});
		if (!existing) throw new ControlPlaneNotFoundError("document", uid);
		const base = ragDocumentFromRow(existing);
		const next: RagDocumentRecord = {
			...base,
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
			...(patch.chunkTotal !== undefined && { chunkTotal: patch.chunkTotal }),
			...(patch.ingestedAt !== undefined && { ingestedAt: patch.ingestedAt }),
			...(patch.status !== undefined && { status: patch.status }),
			...(patch.errorMessage !== undefined && {
				errorMessage: patch.errorMessage,
			}),
			...(patch.metadata !== undefined && {
				metadata: { ...patch.metadata },
			}),
			updatedAt: nowIso(),
		};
		const nextRow = ragDocumentToRow(next);
		const {
			workspace_id: _w,
			knowledge_base_id: _k,
			document_id: _d,
			...fields
		} = nextRow;
		await this.tables.ragDocuments.updateOne(
			{
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				document_id: uid,
			},
			{ $set: fields },
		);
		// Status index — drop the old row when status changed, write the new.
		if (base.status !== next.status) {
			await this.tables.ragDocumentsByStatus.deleteOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				status: base.status,
				document_id: uid,
			});
		}
		await this.writeRagStatusIndex(next);
		// Hash index updates only when content_hash changed.
		if (base.contentHash !== next.contentHash) {
			if (base.contentHash) {
				await this.tables.ragDocumentsByHash.deleteOne({
					content_hash: base.contentHash,
				});
			}
			if (next.contentHash) {
				await this.tables.ragDocumentsByHash.insertOne(
					ragDocumentByHashToRow({
						contentHash: next.contentHash,
						workspaceId: next.workspaceId,
						knowledgeBaseId: next.knowledgeBaseId,
						documentId: next.documentId,
					}),
				);
			}
		}
		return next;
	}

	async deleteRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const existing = await this.tables.ragDocuments.findOne({
			workspace_id: workspace,
			knowledge_base_id: knowledgeBase,
			document_id: uid,
		});
		if (!existing) return { deleted: false };
		const base = ragDocumentFromRow(existing);
		await Promise.all([
			this.tables.ragDocuments.deleteOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				document_id: uid,
			}),
			this.tables.ragDocumentsByStatus.deleteOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				status: base.status,
				document_id: uid,
			}),
			base.contentHash
				? this.tables.ragDocumentsByHash.deleteOne({
						content_hash: base.contentHash,
					})
				: Promise.resolve(),
		]);
		return { deleted: true };
	}

	private async writeRagStatusIndex(rec: RagDocumentRecord): Promise<void> {
		await this.tables.ragDocumentsByStatus.insertOne(
			ragDocumentByStatusToRow({
				workspaceId: rec.workspaceId,
				knowledgeBaseId: rec.knowledgeBaseId,
				status: rec.status,
				documentId: rec.documentId,
				sourceFilename: rec.sourceFilename,
				ingestedAt: rec.ingestedAt,
			}),
		);
	}

	/* ---------------- Chunking services ---------------- */

	async listChunkingServices(
		workspace: string,
	): Promise<readonly ChunkingServiceRecord[]> {
		await this.assertWorkspace(workspace);
		const rows = await this.tables.chunkingServices
			.find({ workspace_id: workspace })
			.toArray();
		return rows.map(chunkingServiceFromRow);
	}

	async getChunkingService(
		workspace: string,
		uid: string,
	): Promise<ChunkingServiceRecord | null> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.chunkingServices.findOne({
			workspace_id: workspace,
			chunking_service_id: uid,
		});
		return row ? chunkingServiceFromRow(row) : null;
	}

	async createChunkingService(
		workspace: string,
		input: CreateChunkingServiceInput,
	): Promise<ChunkingServiceRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		if (
			await this.tables.chunkingServices.findOne({
				workspace_id: workspace,
				chunking_service_id: uid,
			})
		) {
			throw new ControlPlaneConflictError(
				`chunking service with id '${uid}' already exists in workspace '${workspace}'`,
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
		await this.tables.chunkingServices.insertOne(chunkingServiceToRow(record));
		return record;
	}

	async updateChunkingService(
		workspace: string,
		uid: string,
		patch: UpdateChunkingServiceInput,
	): Promise<ChunkingServiceRecord> {
		await this.assertWorkspace(workspace);
		const existing = await this.tables.chunkingServices.findOne({
			workspace_id: workspace,
			chunking_service_id: uid,
		});
		if (!existing) throw new ControlPlaneNotFoundError("chunking service", uid);
		const base = chunkingServiceFromRow(existing);
		const next: ChunkingServiceRecord = {
			...base,
			...mergeDefinedKeys(patch),
			updatedAt: nowIso(),
		};
		const nextRow = chunkingServiceToRow(next);
		const { workspace_id: _w, chunking_service_id: _id, ...fields } = nextRow;
		await this.tables.chunkingServices.updateOne(
			{ workspace_id: workspace, chunking_service_id: uid },
			{ $set: fields },
		);
		return next;
	}

	async deleteChunkingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		await this.assertServiceNotReferenced(workspace, "chunkingServiceId", uid);
		const existing = await this.tables.chunkingServices.findOne({
			workspace_id: workspace,
			chunking_service_id: uid,
		});
		if (!existing) return { deleted: false };
		await this.tables.chunkingServices.deleteOne({
			workspace_id: workspace,
			chunking_service_id: uid,
		});
		return { deleted: true };
	}

	/* ---------------- Embedding services ---------------- */

	async listEmbeddingServices(
		workspace: string,
	): Promise<readonly EmbeddingServiceRecord[]> {
		await this.assertWorkspace(workspace);
		const rows = await this.tables.embeddingServices
			.find({ workspace_id: workspace })
			.toArray();
		return rows.map(embeddingServiceFromRow);
	}

	async getEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<EmbeddingServiceRecord | null> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.embeddingServices.findOne({
			workspace_id: workspace,
			embedding_service_id: uid,
		});
		return row ? embeddingServiceFromRow(row) : null;
	}

	async createEmbeddingService(
		workspace: string,
		input: CreateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		if (
			await this.tables.embeddingServices.findOne({
				workspace_id: workspace,
				embedding_service_id: uid,
			})
		) {
			throw new ControlPlaneConflictError(
				`embedding service with id '${uid}' already exists in workspace '${workspace}'`,
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
		await this.tables.embeddingServices.insertOne(
			embeddingServiceToRow(record),
		);
		return record;
	}

	async updateEmbeddingService(
		workspace: string,
		uid: string,
		patch: UpdateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord> {
		await this.assertWorkspace(workspace);
		const existing = await this.tables.embeddingServices.findOne({
			workspace_id: workspace,
			embedding_service_id: uid,
		});
		if (!existing)
			throw new ControlPlaneNotFoundError("embedding service", uid);
		const base = embeddingServiceFromRow(existing);
		const {
			supportedLanguages: _langs,
			supportedContent: _content,
			...scalarPatch
		} = patch;
		const merged: EmbeddingServiceRecord = {
			...base,
			...mergeDefinedKeys(scalarPatch),
			...(patch.supportedLanguages !== undefined && {
				supportedLanguages: freezeStringSet(patch.supportedLanguages),
			}),
			...(patch.supportedContent !== undefined && {
				supportedContent: freezeStringSet(patch.supportedContent),
			}),
			updatedAt: nowIso(),
		};
		const nextRow = embeddingServiceToRow(merged);
		const { workspace_id: _w, embedding_service_id: _id, ...fields } = nextRow;
		await this.tables.embeddingServices.updateOne(
			{ workspace_id: workspace, embedding_service_id: uid },
			{ $set: fields },
		);
		return merged;
	}

	async deleteEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		await this.assertServiceNotReferenced(workspace, "embeddingServiceId", uid);
		const existing = await this.tables.embeddingServices.findOne({
			workspace_id: workspace,
			embedding_service_id: uid,
		});
		if (!existing) return { deleted: false };
		await this.tables.embeddingServices.deleteOne({
			workspace_id: workspace,
			embedding_service_id: uid,
		});
		return { deleted: true };
	}

	/* ---------------- Reranking services ---------------- */

	async listRerankingServices(
		workspace: string,
	): Promise<readonly RerankingServiceRecord[]> {
		await this.assertWorkspace(workspace);
		const rows = await this.tables.rerankingServices
			.find({ workspace_id: workspace })
			.toArray();
		return rows.map(rerankingServiceFromRow);
	}

	async getRerankingService(
		workspace: string,
		uid: string,
	): Promise<RerankingServiceRecord | null> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.rerankingServices.findOne({
			workspace_id: workspace,
			reranking_service_id: uid,
		});
		return row ? rerankingServiceFromRow(row) : null;
	}

	async createRerankingService(
		workspace: string,
		input: CreateRerankingServiceInput,
	): Promise<RerankingServiceRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		if (
			await this.tables.rerankingServices.findOne({
				workspace_id: workspace,
				reranking_service_id: uid,
			})
		) {
			throw new ControlPlaneConflictError(
				`reranking service with id '${uid}' already exists in workspace '${workspace}'`,
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
		await this.tables.rerankingServices.insertOne(
			rerankingServiceToRow(record),
		);
		return record;
	}

	async updateRerankingService(
		workspace: string,
		uid: string,
		patch: UpdateRerankingServiceInput,
	): Promise<RerankingServiceRecord> {
		await this.assertWorkspace(workspace);
		const existing = await this.tables.rerankingServices.findOne({
			workspace_id: workspace,
			reranking_service_id: uid,
		});
		if (!existing)
			throw new ControlPlaneNotFoundError("reranking service", uid);
		const base = rerankingServiceFromRow(existing);
		const {
			supportedLanguages: _langs,
			supportedContent: _content,
			...scalarPatch
		} = patch;
		const merged: RerankingServiceRecord = {
			...base,
			...mergeDefinedKeys(scalarPatch),
			...(patch.supportedLanguages !== undefined && {
				supportedLanguages: freezeStringSet(patch.supportedLanguages),
			}),
			...(patch.supportedContent !== undefined && {
				supportedContent: freezeStringSet(patch.supportedContent),
			}),
			updatedAt: nowIso(),
		};
		const nextRow = rerankingServiceToRow(merged);
		const { workspace_id: _w, reranking_service_id: _id, ...fields } = nextRow;
		await this.tables.rerankingServices.updateOne(
			{ workspace_id: workspace, reranking_service_id: uid },
			{ $set: fields },
		);
		return merged;
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
		const existing = await this.tables.rerankingServices.findOne({
			workspace_id: workspace,
			reranking_service_id: uid,
		});
		if (!existing) return { deleted: false };
		await this.tables.rerankingServices.deleteOne({
			workspace_id: workspace,
			reranking_service_id: uid,
		});
		return { deleted: true };
	}

	/* ---------------- LLM services ---------------- */

	async listLlmServices(
		workspace: string,
	): Promise<readonly LlmServiceRecord[]> {
		await this.assertWorkspace(workspace);
		const rows = await this.tables.llmServices
			.find({ workspace_id: workspace })
			.toArray();
		return rows.map(llmServiceFromRow);
	}

	async getLlmService(
		workspace: string,
		uid: string,
	): Promise<LlmServiceRecord | null> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.llmServices.findOne({
			workspace_id: workspace,
			llm_service_id: uid,
		});
		return row ? llmServiceFromRow(row) : null;
	}

	async createLlmService(
		workspace: string,
		input: CreateLlmServiceInput,
	): Promise<LlmServiceRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		if (
			await this.tables.llmServices.findOne({
				workspace_id: workspace,
				llm_service_id: uid,
			})
		) {
			throw new ControlPlaneConflictError(
				`llm service with id '${uid}' already exists in workspace '${workspace}'`,
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
		await this.tables.llmServices.insertOne(llmServiceToRow(record));
		return record;
	}

	async updateLlmService(
		workspace: string,
		uid: string,
		patch: UpdateLlmServiceInput,
	): Promise<LlmServiceRecord> {
		await this.assertWorkspace(workspace);
		const existing = await this.tables.llmServices.findOne({
			workspace_id: workspace,
			llm_service_id: uid,
		});
		if (!existing) throw new ControlPlaneNotFoundError("llm service", uid);
		const base = llmServiceFromRow(existing);
		const {
			supportedLanguages: _langs,
			supportedContent: _content,
			...scalarPatch
		} = patch;
		const merged: LlmServiceRecord = {
			...base,
			...mergeDefinedKeys(scalarPatch),
			...(patch.supportedLanguages !== undefined && {
				supportedLanguages: freezeStringSet(patch.supportedLanguages),
			}),
			...(patch.supportedContent !== undefined && {
				supportedContent: freezeStringSet(patch.supportedContent),
			}),
			updatedAt: nowIso(),
		};
		const nextRow = llmServiceToRow(merged);
		const { workspace_id: _w, llm_service_id: _id, ...fields } = nextRow;
		await this.tables.llmServices.updateOne(
			{ workspace_id: workspace, llm_service_id: uid },
			{ $set: fields },
		);
		return merged;
	}

	async deleteLlmService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		await this.assertAgentServiceNotReferenced(workspace, "llmServiceId", uid);
		const existing = await this.tables.llmServices.findOne({
			workspace_id: workspace,
			llm_service_id: uid,
		});
		if (!existing) return { deleted: false };
		await this.tables.llmServices.deleteOne({
			workspace_id: workspace,
			llm_service_id: uid,
		});
		return { deleted: true };
	}

	/* ---------------- Agents ---------------- */

	async listAgents(workspaceId: string): Promise<readonly AgentRecord[]> {
		await this.assertWorkspace(workspaceId);
		const rows = await this.tables.agents
			.find({ workspace_id: workspaceId })
			.toArray();
		return rows.map(agentFromRow).sort(byCreatedAtAscAgent);
	}

	async getAgent(
		workspaceId: string,
		agentId: string,
	): Promise<AgentRecord | null> {
		await this.assertWorkspace(workspaceId);
		const row = await this.tables.agents.findOne({
			workspace_id: workspaceId,
			agent_id: agentId,
		});
		return row ? agentFromRow(row) : null;
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
		const agentId = input.agentId ?? randomUUID();
		const existing = await this.tables.agents.findOne({
			workspace_id: workspaceId,
			agent_id: agentId,
		});
		if (existing) {
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
		await this.tables.agents.insertOne(agentToRow(record));
		return record;
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
		const existingRow = await this.tables.agents.findOne({
			workspace_id: workspaceId,
			agent_id: agentId,
		});
		if (!existingRow) {
			throw new ControlPlaneNotFoundError("agent", agentId);
		}
		const existing = agentFromRow(existingRow);
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
		const nextRow = agentToRow(next);
		await this.tables.agents.updateOne(
			{ workspace_id: workspaceId, agent_id: agentId },
			{
				$set: {
					name: nextRow.name,
					description: nextRow.description,
					system_prompt: nextRow.system_prompt,
					user_prompt: nextRow.user_prompt,
					llm_service_id: nextRow.llm_service_id,
					knowledge_base_ids: nextRow.knowledge_base_ids,
					rag_enabled: nextRow.rag_enabled,
					rag_max_results: nextRow.rag_max_results,
					rag_min_score: nextRow.rag_min_score,
					rerank_enabled: nextRow.rerank_enabled,
					reranking_service_id: nextRow.reranking_service_id,
					rerank_max_results: nextRow.rerank_max_results,
					updated_at: nextRow.updated_at,
				},
			},
		);
		return next;
	}

	async deleteAgent(
		workspaceId: string,
		agentId: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspaceId);
		const existing = await this.tables.agents.findOne({
			workspace_id: workspaceId,
			agent_id: agentId,
		});
		if (!existing) return { deleted: false };
		// Cascade conversations + their messages. Messages are partitioned
		// by (workspace, conversation) — we read the agent's conversation
		// ids, then delete each partition in turn (no cross-partition
		// secondary index for messages keyed on agent_id).
		const convRows = await this.tables.conversations
			.find({ workspace_id: workspaceId, agent_id: agentId })
			.toArray();
		await this.tables.agents.deleteOne({
			workspace_id: workspaceId,
			agent_id: agentId,
		});
		await this.tables.conversations.deleteMany({
			workspace_id: workspaceId,
			agent_id: agentId,
		});
		for (const conv of convRows) {
			await this.tables.messages.deleteMany({
				workspace_id: workspaceId,
				conversation_id: conv.conversation_id,
			});
		}
		return { deleted: true };
	}

	/* ---------------- Conversations (agent-scoped) ---------------- */

	async listConversations(
		workspaceId: string,
		agentId: string,
	): Promise<readonly ConversationRecord[]> {
		await this.assertWorkspace(workspaceId);
		const rows = await this.tables.conversations
			.find({ workspace_id: workspaceId, agent_id: agentId })
			.toArray();
		// Astra's `created_at DESC` cluster ordering is enforced server-
		// side, but the fake bundle in tests doesn't honor cluster keys.
		// Sort defensively so tests and prod agree.
		return rows.map(conversationFromRow).sort(byCreatedAtDescConv);
	}

	async getConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<ConversationRecord | null> {
		await this.assertWorkspace(workspaceId);
		const row = await this.tables.conversations.findOne({
			workspace_id: workspaceId,
			agent_id: agentId,
			conversation_id: conversationId,
		});
		return row ? conversationFromRow(row) : null;
	}

	async createConversation(
		workspaceId: string,
		agentId: string,
		input: CreateConversationInput,
	): Promise<ConversationRecord> {
		await this.assertAgent(workspaceId, agentId);
		const conversationId = input.conversationId ?? randomUUID();
		const existing = await this.tables.conversations.findOne({
			workspace_id: workspaceId,
			agent_id: agentId,
			conversation_id: conversationId,
		});
		if (existing) {
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
		await this.tables.conversations.insertOne(conversationToRow(record));
		return record;
	}

	async updateConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
		patch: UpdateConversationInput,
	): Promise<ConversationRecord> {
		await this.assertWorkspace(workspaceId);
		const existingRow = await this.tables.conversations.findOne({
			workspace_id: workspaceId,
			agent_id: agentId,
			conversation_id: conversationId,
		});
		if (!existingRow) {
			throw new ControlPlaneNotFoundError("conversation", conversationId);
		}
		const existing = conversationFromRow(existingRow);
		const next: ConversationRecord = {
			...existing,
			...(patch.title !== undefined && { title: patch.title }),
			...(patch.knowledgeBaseIds !== undefined && {
				knowledgeBaseIds: freezeStringSet(patch.knowledgeBaseIds),
			}),
		};
		const nextRow = conversationToRow(next);
		await this.tables.conversations.updateOne(
			{
				workspace_id: workspaceId,
				agent_id: agentId,
				created_at: existingRow.created_at,
				conversation_id: conversationId,
			},
			{
				$set: {
					title: nextRow.title,
					knowledge_base_ids: nextRow.knowledge_base_ids,
				},
			},
		);
		return next;
	}

	async deleteConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspaceId);
		const existing = await this.tables.conversations.findOne({
			workspace_id: workspaceId,
			agent_id: agentId,
			conversation_id: conversationId,
		});
		if (!existing) return { deleted: false };
		await this.tables.conversations.deleteOne({
			workspace_id: workspaceId,
			agent_id: agentId,
			created_at: existing.created_at,
			conversation_id: conversationId,
		});
		await this.tables.messages.deleteMany({
			workspace_id: workspaceId,
			conversation_id: conversationId,
		});
		return { deleted: true };
	}

	/* ---------------- Chat messages ---------------- */

	async listChatMessages(
		workspaceId: string,
		chatId: string,
	): Promise<readonly MessageRecord[]> {
		await this.assertChat(workspaceId, chatId);
		const rows = await this.tables.messages
			.find({ workspace_id: workspaceId, conversation_id: chatId })
			.toArray();
		return rows.map(messageFromRow).sort(byMessageTsAsc);
	}

	async appendChatMessage(
		workspaceId: string,
		chatId: string,
		input: AppendChatMessageInput,
	): Promise<MessageRecord> {
		await this.assertChat(workspaceId, chatId);
		const messageId = input.messageId ?? randomUUID();
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
		// Cluster key is `(message_ts ASC)`. We don't probe for an
		// existing row first (`message_id` isn't part of the key, so a
		// `findOne` filter on it isn't a partition lookup) — Astra
		// allows multiple rows in the same partition with different
		// timestamps, and the contract is "callers either let the store
		// stamp or supply a unique pair." If a duplicate (workspace,
		// chat, ts, id) ever does happen, the second insertOne becomes
		// an upsert; acceptable for v0.
		await this.tables.messages.insertOne(messageToRow(record));
		return record;
	}

	async updateChatMessage(
		workspaceId: string,
		chatId: string,
		messageId: string,
		patch: UpdateChatMessageInput,
	): Promise<MessageRecord> {
		await this.assertChat(workspaceId, chatId);
		// `message_id` isn't part of the cluster key, so we read the
		// matching partition and find by id client-side. v0 chats are
		// bounded; if message lists grow large we'll add a `_by_id`
		// secondary index.
		const rows = await this.tables.messages
			.find({ workspace_id: workspaceId, conversation_id: chatId })
			.toArray();
		const existingRow = rows.find((r) => r.message_id === messageId);
		if (!existingRow) {
			throw new ControlPlaneNotFoundError("chat message", messageId);
		}
		const existing = messageFromRow(existingRow);
		const next: MessageRecord = {
			...existing,
			...(patch.content !== undefined && { content: patch.content }),
			...(patch.tokenCount !== undefined && { tokenCount: patch.tokenCount }),
			...(patch.metadata !== undefined && {
				metadata: mergeMessageMetadata(existing.metadata, patch.metadata),
			}),
		};
		const nextRow = messageToRow(next);
		await this.tables.messages.updateOne(
			{
				workspace_id: workspaceId,
				conversation_id: chatId,
				message_ts: existingRow.message_ts,
			},
			{
				$set: {
					content: nextRow.content,
					token_count: nextRow.token_count,
					metadata: nextRow.metadata,
				},
			},
		);
		return next;
	}

	/**
	 * Resolve a conversation across any agent in the workspace. Messages
	 * are partitioned by (workspace, conversation) only — append /
	 * list / update don't need an agent argument. The workspace-wide
	 * find is bounded (one row per conversation; v0 chats are O(10s) at
	 * most) and a `_by_workspace` secondary index can be added later if
	 * the workload grows.
	 */
	private async assertChat(workspaceId: string, chatId: string): Promise<void> {
		await this.assertWorkspace(workspaceId);
		const row = await this.tables.conversations.findOne({
			workspace_id: workspaceId,
			conversation_id: chatId,
		});
		if (!row) {
			throw new ControlPlaneNotFoundError("chat", chatId);
		}
	}

	private async assertAgent(
		workspaceId: string,
		agentId: string,
	): Promise<void> {
		await this.assertWorkspace(workspaceId);
		const row = await this.tables.agents.findOne({
			workspace_id: workspaceId,
			agent_id: agentId,
		});
		if (!row) {
			throw new ControlPlaneNotFoundError("agent", agentId);
		}
	}

	/* ---------------- Helpers ---------------- */

	private async assertWorkspace(uid: string): Promise<void> {
		const row = await this.tables.workspaces.findOne({ uid });
		if (!row) throw new ControlPlaneNotFoundError("workspace", uid);
	}

	private async assertKnowledgeBase(
		workspace: string,
		knowledgeBase: string,
	): Promise<void> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.knowledgeBases.findOne({
			workspace_id: workspace,
			knowledge_base_id: knowledgeBase,
		});
		if (!row) {
			throw new ControlPlaneNotFoundError("knowledge base", knowledgeBase);
		}
	}

	private async assertChunkingService(
		workspace: string,
		uid: string,
	): Promise<void> {
		const row = await this.tables.chunkingServices.findOne({
			workspace_id: workspace,
			chunking_service_id: uid,
		});
		if (!row) throw new ControlPlaneNotFoundError("chunking service", uid);
	}

	private async assertEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<void> {
		const row = await this.tables.embeddingServices.findOne({
			workspace_id: workspace,
			embedding_service_id: uid,
		});
		if (!row) throw new ControlPlaneNotFoundError("embedding service", uid);
	}

	private async assertRerankingService(
		workspace: string,
		uid: string,
	): Promise<void> {
		const row = await this.tables.rerankingServices.findOne({
			workspace_id: workspace,
			reranking_service_id: uid,
		});
		if (!row) throw new ControlPlaneNotFoundError("reranking service", uid);
	}

	private async assertLlmService(
		workspace: string,
		uid: string,
	): Promise<void> {
		const row = await this.tables.llmServices.findOne({
			workspace_id: workspace,
			llm_service_id: uid,
		});
		if (!row) throw new ControlPlaneNotFoundError("llm service", uid);
	}

	private async assertServiceNotReferenced(
		workspace: string,
		field: "embeddingServiceId" | "chunkingServiceId" | "rerankingServiceId",
		serviceId: string,
	): Promise<void> {
		const rows = await this.tables.knowledgeBases
			.find({ workspace_id: workspace })
			.toArray();
		const fieldOnRow: keyof (typeof rows)[number] =
			field === "embeddingServiceId"
				? "embedding_service_id"
				: field === "chunkingServiceId"
					? "chunking_service_id"
					: "reranking_service_id";
		const ref = rows.find((kb) => kb[fieldOnRow] === serviceId);
		if (ref) {
			throw new ControlPlaneConflictError(
				`service '${serviceId}' is referenced by knowledge base '${ref.knowledge_base_id}' (${field})`,
			);
		}
	}

	/**
	 * Refuse to delete a service that any agent in the workspace still
	 * references on the given field. Mirrors the memory-store helper of
	 * the same name. There's no secondary index keyed by service id, so
	 * we read the workspace's agents and filter client-side. v0
	 * workspaces are bounded; if agent counts grow we'll add a
	 * `_by_service` index.
	 */
	private async assertAgentServiceNotReferenced(
		workspace: string,
		field: "llmServiceId" | "rerankingServiceId",
		serviceId: string,
	): Promise<void> {
		const rows = await this.tables.agents
			.find({ workspace_id: workspace })
			.toArray();
		const fieldOnRow: keyof (typeof rows)[number] =
			field === "llmServiceId" ? "llm_service_id" : "reranking_service_id";
		const ref = rows.find((agent) => agent[fieldOnRow] === serviceId);
		if (ref) {
			throw new ControlPlaneConflictError(
				`service '${serviceId}' is referenced by agent '${ref.agent_id}' (${field})`,
			);
		}
	}
}

/**
 * Spread a `Partial<...>` patch onto an existing record, ignoring
 * `undefined` values. Mirrors what we do for vector-store updates but
 * generalised so it works across the KB-schema service updaters.
 *
 * Set-typed columns aren't handled here because their input shape
 * (`readonly string[] | ReadonlySet<string>`) doesn't match the record
 * shape (`ReadonlySet<string>`); call sites override them after.
 */
function mergeDefinedKeys<T extends object>(patch: T): Partial<T> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
		if (v !== undefined) out[k] = v;
	}
	return out as Partial<T>;
}
