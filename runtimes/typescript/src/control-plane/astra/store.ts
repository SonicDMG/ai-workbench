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
	apiKeyFromRow,
	apiKeyToRow,
	chunkingServiceFromRow,
	chunkingServiceToRow,
	embeddingServiceFromRow,
	embeddingServiceToRow,
	knowledgeBaseFromRow,
	knowledgeBaseToRow,
	knowledgeFilterFromRow,
	knowledgeFilterToRow,
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
	ControlPlaneStore,
	CreateChunkingServiceInput,
	CreateEmbeddingServiceInput,
	CreateKnowledgeBaseInput,
	CreateKnowledgeFilterInput,
	CreateRagDocumentInput,
	CreateRerankingServiceInput,
	CreateWorkspaceInput,
	PersistApiKeyInput,
	UpdateChunkingServiceInput,
	UpdateEmbeddingServiceInput,
	UpdateKnowledgeBaseInput,
	UpdateKnowledgeFilterInput,
	UpdateRagDocumentInput,
	UpdateRerankingServiceInput,
	UpdateWorkspaceInput,
} from "../store.js";
import type {
	ApiKeyRecord,
	ChunkingServiceRecord,
	EmbeddingServiceRecord,
	KnowledgeBaseRecord,
	KnowledgeFilterRecord,
	RagDocumentRecord,
	RerankingServiceRecord,
	WorkspaceRecord,
} from "../types.js";

function freezeStringSet(
	value: ReadonlySet<string> | readonly string[] | undefined,
): readonly string[] {
	return Object.freeze([...new Set(value ?? [])].sort());
}

export class AstraControlPlaneStore implements ControlPlaneStore {
	constructor(private readonly tables: TablesBundle) {}

	/* ---------------- Workspaces ---------------- */

	async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
		const rows = await this.tables.workspaces.find({}).toArray();
		return rows.map(workspaceFromRow).sort(byCreatedAtThenUid);
	}

	async getWorkspace(uid: string): Promise<WorkspaceRecord | null> {
		const row = await this.tables.workspaces.findOne({ uid });
		return row ? workspaceFromRow(row) : null;
	}

	async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
		const uid = input.uid ?? randomUUID();
		if (await this.tables.workspaces.findOne({ uid })) {
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
			namespace: input.namespace ?? null,
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
			...(patch.namespace !== undefined && { namespace: patch.namespace }),
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
			this.tables.ragDocuments.deleteMany({ workspace_id: uid }),
			this.tables.ragDocumentsByStatus.deleteMany({ workspace_id: uid }),
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
			vectorCollection: input.vectorCollection ?? defaultVectorCollection(uid),
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
				`document with uid '${uid}' already exists in knowledge base '${knowledgeBase}'`,
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

	private async assertServiceNotReferenced(
		workspace: string,
		field: "embeddingServiceId" | "chunkingServiceId" | "rerankingServiceId",
		serviceUid: string,
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
		const ref = rows.find((kb) => kb[fieldOnRow] === serviceUid);
		if (ref) {
			throw new ControlPlaneConflictError(
				`service '${serviceUid}' is referenced by knowledge base '${ref.knowledge_base_id}' (${field})`,
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
