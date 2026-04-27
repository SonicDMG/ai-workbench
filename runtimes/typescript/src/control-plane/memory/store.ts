/**
 * In-memory {@link ../store.ControlPlaneStore}.
 *
 * Default backend for CI and `docker run` with no external dependencies.
 * Not durable — state is lost when the process exits.
 *
 * Internal layout mirrors the CQL partition structure:
 *   workspaces          : Map<workspaceUid, WorkspaceRecord>
 *   knowledgeBases      : Map<workspaceUid, Map<kbUid, KnowledgeBaseRecord>>
 *   ragDocuments        : Map<`${workspaceUid}:${kbUid}`, Map<docUid, RagDocumentRecord>>
 *   apiKeys             : Map<workspaceUid, Map<keyId, ApiKeyRecord>>
 *
 * This keeps lookups O(log N) on JS's Map while matching the physical
 * storage semantics one-to-one.
 */

import { randomUUID } from "node:crypto";
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
	CreateRagDocumentInput,
	CreateRerankingServiceInput,
	CreateWorkspaceInput,
	PersistApiKeyInput,
	UpdateChunkingServiceInput,
	UpdateEmbeddingServiceInput,
	UpdateKnowledgeBaseInput,
	UpdateRagDocumentInput,
	UpdateRerankingServiceInput,
	UpdateWorkspaceInput,
} from "../store.js";
import type {
	ApiKeyRecord,
	ChunkingServiceRecord,
	EmbeddingServiceRecord,
	KnowledgeBaseRecord,
	RagDocumentRecord,
	RerankingServiceRecord,
	WorkspaceRecord,
} from "../types.js";

/**
 * Normalise a `Set | array | undefined` input into a deduplicated,
 * sorted, frozen array. Sorted because callers expect deterministic
 * ordering on the wire — and the Astra column type is `SET<TEXT>`,
 * which is also deduplicated. */
function freezeStringSet(
	value: ReadonlySet<string> | readonly string[] | undefined,
): readonly string[] {
	const arr = [...new Set(value ?? [])].sort();
	return Object.freeze(arr);
}

function docKey(workspace: string, catalog: string): string {
	return `${workspace}:${catalog}`;
}

function freezeMetadata(
	m: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
	return Object.freeze({ ...(m ?? {}) });
}

function freezeCredentials(
	c: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
	return Object.freeze({ ...(c ?? {}) });
}

export class MemoryControlPlaneStore implements ControlPlaneStore {
	private readonly workspaces = new Map<string, WorkspaceRecord>();
	// KB-scoped RAG documents (issue #98). `${workspaceUid}:${kbUid}`
	// keyed.
	private readonly ragDocuments = new Map<
		string,
		Map<string, RagDocumentRecord>
	>();
	private readonly apiKeys = new Map<string, Map<string, ApiKeyRecord>>();
	private readonly apiKeyPrefixIndex = new Map<string, ApiKeyRecord>();
	// Knowledge-base schema (issue #98). All four maps follow the same
	// `Map<workspaceUid, Map<recordUid, Record>>` shape.
	private readonly knowledgeBases = new Map<
		string,
		Map<string, KnowledgeBaseRecord>
	>();
	private readonly chunkingServices = new Map<
		string,
		Map<string, ChunkingServiceRecord>
	>();
	private readonly embeddingServices = new Map<
		string,
		Map<string, EmbeddingServiceRecord>
	>();
	private readonly rerankingServices = new Map<
		string,
		Map<string, RerankingServiceRecord>
	>();

	/* ---------------- Workspaces ---------------- */

	async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
		return Array.from(this.workspaces.values()).sort(byCreatedAtThenUid);
	}

	async getWorkspace(uid: string): Promise<WorkspaceRecord | null> {
		return this.workspaces.get(uid) ?? null;
	}

	async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
		const uid = input.uid ?? randomUUID();
		if (this.workspaces.has(uid)) {
			throw new ControlPlaneConflictError(
				`workspace with uid '${uid}' already exists`,
			);
		}
		const now = nowIso();
		const record: WorkspaceRecord = {
			uid,
			name: input.name,
			endpoint: input.endpoint ?? null,
			kind: input.kind,
			credentialsRef: freezeCredentials(input.credentialsRef),
			keyspace: input.keyspace ?? null,
			createdAt: now,
			updatedAt: now,
		};
		this.workspaces.set(uid, record);
		return record;
	}

	async updateWorkspace(
		uid: string,
		patch: UpdateWorkspaceInput,
	): Promise<WorkspaceRecord> {
		const existing = this.workspaces.get(uid);
		if (!existing) {
			throw new ControlPlaneNotFoundError("workspace", uid);
		}
		const next: WorkspaceRecord = {
			...existing,
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.endpoint !== undefined && { endpoint: patch.endpoint }),
			...(patch.credentialsRef !== undefined && {
				credentialsRef: freezeCredentials(patch.credentialsRef),
			}),
			...(patch.keyspace !== undefined && { keyspace: patch.keyspace }),
			updatedAt: nowIso(),
		};
		this.workspaces.set(uid, next);
		return next;
	}

	async deleteWorkspace(uid: string): Promise<{ deleted: boolean }> {
		const deleted = this.workspaces.delete(uid);
		// Cascade: delete all dependent partitions.
		const keys = this.apiKeys.get(uid);
		if (keys) {
			for (const rec of keys.values())
				this.apiKeyPrefixIndex.delete(rec.prefix);
			this.apiKeys.delete(uid);
		}
		this.knowledgeBases.delete(uid);
		this.chunkingServices.delete(uid);
		this.embeddingServices.delete(uid);
		this.rerankingServices.delete(uid);
		for (const key of Array.from(this.ragDocuments.keys())) {
			if (key.startsWith(`${uid}:`)) this.ragDocuments.delete(key);
		}
		return { deleted };
	}

	/* ---------------- RAG documents (KB-scoped) ---------------- */

	async listRagDocuments(
		workspace: string,
		knowledgeBase: string,
	): Promise<readonly RagDocumentRecord[]> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		return Array.from(
			this.ragDocuments.get(docKey(workspace, knowledgeBase))?.values() ?? [],
		);
	}

	async getRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<RagDocumentRecord | null> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		return (
			this.ragDocuments.get(docKey(workspace, knowledgeBase))?.get(uid) ?? null
		);
	}

	async createRagDocument(
		workspace: string,
		knowledgeBase: string,
		input: CreateRagDocumentInput,
	): Promise<RagDocumentRecord> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const key = docKey(workspace, knowledgeBase);
		const uid = input.uid ?? randomUUID();
		const bucket = this.ragDocuments.get(key) ?? new Map();
		if (bucket.has(uid)) {
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
			metadata: freezeMetadata(input.metadata),
		};
		bucket.set(uid, record);
		this.ragDocuments.set(key, bucket);
		return record;
	}

	async updateRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
		patch: UpdateRagDocumentInput,
	): Promise<RagDocumentRecord> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		const key = docKey(workspace, knowledgeBase);
		const existing = this.ragDocuments.get(key)?.get(uid);
		if (!existing) {
			throw new ControlPlaneNotFoundError("document", uid);
		}
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
			...(patch.chunkTotal !== undefined && { chunkTotal: patch.chunkTotal }),
			...(patch.ingestedAt !== undefined && { ingestedAt: patch.ingestedAt }),
			...(patch.status !== undefined && { status: patch.status }),
			...(patch.errorMessage !== undefined && {
				errorMessage: patch.errorMessage,
			}),
			...(patch.metadata !== undefined && {
				metadata: freezeMetadata(patch.metadata),
			}),
			updatedAt: nowIso(),
		};
		this.ragDocuments.get(key)?.set(uid, next);
		return next;
	}

	async deleteRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertKnowledgeBase(workspace, knowledgeBase);
		return {
			deleted:
				this.ragDocuments.get(docKey(workspace, knowledgeBase))?.delete(uid) ??
				false,
		};
	}

	/* ---------------- API keys ---------------- */

	async listApiKeys(workspace: string): Promise<readonly ApiKeyRecord[]> {
		await this.assertWorkspace(workspace);
		return Array.from(this.apiKeys.get(workspace)?.values() ?? []).sort(
			byCreatedAtThenKeyId,
		);
	}

	async getApiKey(
		workspace: string,
		keyId: string,
	): Promise<ApiKeyRecord | null> {
		await this.assertWorkspace(workspace);
		return this.apiKeys.get(workspace)?.get(keyId) ?? null;
	}

	async persistApiKey(
		workspace: string,
		input: PersistApiKeyInput,
	): Promise<ApiKeyRecord> {
		await this.assertWorkspace(workspace);
		if (this.apiKeyPrefixIndex.has(input.prefix)) {
			throw new ControlPlaneConflictError(
				`api key with prefix '${input.prefix}' already exists`,
			);
		}
		const bucket = this.apiKeys.get(workspace) ?? new Map();
		if (bucket.has(input.keyId)) {
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
		bucket.set(input.keyId, record);
		this.apiKeys.set(workspace, bucket);
		this.apiKeyPrefixIndex.set(input.prefix, record);
		return record;
	}

	async revokeApiKey(
		workspace: string,
		keyId: string,
	): Promise<{ revoked: boolean }> {
		await this.assertWorkspace(workspace);
		const existing = this.apiKeys.get(workspace)?.get(keyId);
		if (!existing) return { revoked: false };
		if (existing.revokedAt !== null) return { revoked: false };
		const revoked: ApiKeyRecord = { ...existing, revokedAt: nowIso() };
		this.apiKeys.get(workspace)?.set(keyId, revoked);
		this.apiKeyPrefixIndex.set(existing.prefix, revoked);
		return { revoked: true };
	}

	async findApiKeyByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
		return this.apiKeyPrefixIndex.get(prefix) ?? null;
	}

	async touchApiKey(workspace: string, keyId: string): Promise<void> {
		const existing = this.apiKeys.get(workspace)?.get(keyId);
		if (!existing) return;
		const touched: ApiKeyRecord = { ...existing, lastUsedAt: nowIso() };
		this.apiKeys.get(workspace)?.set(keyId, touched);
		this.apiKeyPrefixIndex.set(existing.prefix, touched);
	}

	/* ---------------- Knowledge bases (issue #98) ---------------- */

	async listKnowledgeBases(
		workspace: string,
	): Promise<readonly KnowledgeBaseRecord[]> {
		await this.assertWorkspace(workspace);
		return Array.from(this.knowledgeBases.get(workspace)?.values() ?? []);
	}

	async getKnowledgeBase(
		workspace: string,
		uid: string,
	): Promise<KnowledgeBaseRecord | null> {
		await this.assertWorkspace(workspace);
		return this.knowledgeBases.get(workspace)?.get(uid) ?? null;
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
		const bucket = this.knowledgeBases.get(workspace) ?? new Map();
		if (bucket.has(uid)) {
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
		bucket.set(uid, record);
		this.knowledgeBases.set(workspace, bucket);
		return record;
	}

	async updateKnowledgeBase(
		workspace: string,
		uid: string,
		patch: UpdateKnowledgeBaseInput,
	): Promise<KnowledgeBaseRecord> {
		await this.assertWorkspace(workspace);
		const existing = this.knowledgeBases.get(workspace)?.get(uid);
		if (!existing) {
			throw new ControlPlaneNotFoundError("knowledge base", uid);
		}
		if (
			patch.rerankingServiceId !== undefined &&
			patch.rerankingServiceId !== null
		) {
			await this.assertRerankingService(workspace, patch.rerankingServiceId);
		}
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
		this.knowledgeBases.get(workspace)?.set(uid, next);
		return next;
	}

	async deleteKnowledgeBase(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		const deleted = this.knowledgeBases.get(workspace)?.delete(uid) ?? false;
		if (deleted) {
			// Cascade RAG document rows so the next create with the same
			// uid starts clean. Underlying vector collection cleanup is the
			// caller's responsibility (KB delete route handles it).
			this.ragDocuments.delete(docKey(workspace, uid));
		}
		return { deleted };
	}

	/* ---------------- Chunking services ---------------- */

	async listChunkingServices(
		workspace: string,
	): Promise<readonly ChunkingServiceRecord[]> {
		await this.assertWorkspace(workspace);
		return Array.from(this.chunkingServices.get(workspace)?.values() ?? []);
	}

	async getChunkingService(
		workspace: string,
		uid: string,
	): Promise<ChunkingServiceRecord | null> {
		await this.assertWorkspace(workspace);
		return this.chunkingServices.get(workspace)?.get(uid) ?? null;
	}

	async createChunkingService(
		workspace: string,
		input: CreateChunkingServiceInput,
	): Promise<ChunkingServiceRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		const bucket = this.chunkingServices.get(workspace) ?? new Map();
		if (bucket.has(uid)) {
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
		bucket.set(uid, record);
		this.chunkingServices.set(workspace, bucket);
		return record;
	}

	async updateChunkingService(
		workspace: string,
		uid: string,
		patch: UpdateChunkingServiceInput,
	): Promise<ChunkingServiceRecord> {
		await this.assertWorkspace(workspace);
		const existing = this.chunkingServices.get(workspace)?.get(uid);
		if (!existing) {
			throw new ControlPlaneNotFoundError("chunking service", uid);
		}
		const next: ChunkingServiceRecord = {
			...existing,
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.description !== undefined && {
				description: patch.description,
			}),
			...(patch.status !== undefined && { status: patch.status }),
			...(patch.engine !== undefined && { engine: patch.engine }),
			...(patch.engineVersion !== undefined && {
				engineVersion: patch.engineVersion,
			}),
			...(patch.strategy !== undefined && { strategy: patch.strategy }),
			...(patch.maxChunkSize !== undefined && {
				maxChunkSize: patch.maxChunkSize,
			}),
			...(patch.minChunkSize !== undefined && {
				minChunkSize: patch.minChunkSize,
			}),
			...(patch.chunkUnit !== undefined && { chunkUnit: patch.chunkUnit }),
			...(patch.overlapSize !== undefined && {
				overlapSize: patch.overlapSize,
			}),
			...(patch.overlapUnit !== undefined && {
				overlapUnit: patch.overlapUnit,
			}),
			...(patch.preserveStructure !== undefined && {
				preserveStructure: patch.preserveStructure,
			}),
			...(patch.language !== undefined && { language: patch.language }),
			...(patch.endpointBaseUrl !== undefined && {
				endpointBaseUrl: patch.endpointBaseUrl,
			}),
			...(patch.endpointPath !== undefined && {
				endpointPath: patch.endpointPath,
			}),
			...(patch.requestTimeoutMs !== undefined && {
				requestTimeoutMs: patch.requestTimeoutMs,
			}),
			...(patch.authType !== undefined && { authType: patch.authType }),
			...(patch.credentialRef !== undefined && {
				credentialRef: patch.credentialRef,
			}),
			...(patch.maxPayloadSizeKb !== undefined && {
				maxPayloadSizeKb: patch.maxPayloadSizeKb,
			}),
			...(patch.enableOcr !== undefined && { enableOcr: patch.enableOcr }),
			...(patch.extractTables !== undefined && {
				extractTables: patch.extractTables,
			}),
			...(patch.extractFigures !== undefined && {
				extractFigures: patch.extractFigures,
			}),
			...(patch.readingOrder !== undefined && {
				readingOrder: patch.readingOrder,
			}),
			updatedAt: nowIso(),
		};
		this.chunkingServices.get(workspace)?.set(uid, next);
		return next;
	}

	async deleteChunkingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		this.assertServiceNotReferenced(workspace, "chunkingServiceId", uid);
		return {
			deleted: this.chunkingServices.get(workspace)?.delete(uid) ?? false,
		};
	}

	/* ---------------- Embedding services ---------------- */

	async listEmbeddingServices(
		workspace: string,
	): Promise<readonly EmbeddingServiceRecord[]> {
		await this.assertWorkspace(workspace);
		return Array.from(this.embeddingServices.get(workspace)?.values() ?? []);
	}

	async getEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<EmbeddingServiceRecord | null> {
		await this.assertWorkspace(workspace);
		return this.embeddingServices.get(workspace)?.get(uid) ?? null;
	}

	async createEmbeddingService(
		workspace: string,
		input: CreateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		const bucket = this.embeddingServices.get(workspace) ?? new Map();
		if (bucket.has(uid)) {
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
		bucket.set(uid, record);
		this.embeddingServices.set(workspace, bucket);
		return record;
	}

	async updateEmbeddingService(
		workspace: string,
		uid: string,
		patch: UpdateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord> {
		await this.assertWorkspace(workspace);
		const existing = this.embeddingServices.get(workspace)?.get(uid);
		if (!existing) {
			throw new ControlPlaneNotFoundError("embedding service", uid);
		}
		const next: EmbeddingServiceRecord = {
			...existing,
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.description !== undefined && {
				description: patch.description,
			}),
			...(patch.status !== undefined && { status: patch.status }),
			...(patch.provider !== undefined && { provider: patch.provider }),
			...(patch.modelName !== undefined && { modelName: patch.modelName }),
			...(patch.embeddingDimension !== undefined && {
				embeddingDimension: patch.embeddingDimension,
			}),
			...(patch.distanceMetric !== undefined && {
				distanceMetric: patch.distanceMetric,
			}),
			...(patch.endpointBaseUrl !== undefined && {
				endpointBaseUrl: patch.endpointBaseUrl,
			}),
			...(patch.endpointPath !== undefined && {
				endpointPath: patch.endpointPath,
			}),
			...(patch.requestTimeoutMs !== undefined && {
				requestTimeoutMs: patch.requestTimeoutMs,
			}),
			...(patch.maxBatchSize !== undefined && {
				maxBatchSize: patch.maxBatchSize,
			}),
			...(patch.maxInputTokens !== undefined && {
				maxInputTokens: patch.maxInputTokens,
			}),
			...(patch.authType !== undefined && { authType: patch.authType }),
			...(patch.credentialRef !== undefined && {
				credentialRef: patch.credentialRef,
			}),
			...(patch.supportedLanguages !== undefined && {
				supportedLanguages: freezeStringSet(patch.supportedLanguages),
			}),
			...(patch.supportedContent !== undefined && {
				supportedContent: freezeStringSet(patch.supportedContent),
			}),
			updatedAt: nowIso(),
		};
		this.embeddingServices.get(workspace)?.set(uid, next);
		return next;
	}

	async deleteEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		this.assertServiceNotReferenced(workspace, "embeddingServiceId", uid);
		return {
			deleted: this.embeddingServices.get(workspace)?.delete(uid) ?? false,
		};
	}

	/* ---------------- Reranking services ---------------- */

	async listRerankingServices(
		workspace: string,
	): Promise<readonly RerankingServiceRecord[]> {
		await this.assertWorkspace(workspace);
		return Array.from(this.rerankingServices.get(workspace)?.values() ?? []);
	}

	async getRerankingService(
		workspace: string,
		uid: string,
	): Promise<RerankingServiceRecord | null> {
		await this.assertWorkspace(workspace);
		return this.rerankingServices.get(workspace)?.get(uid) ?? null;
	}

	async createRerankingService(
		workspace: string,
		input: CreateRerankingServiceInput,
	): Promise<RerankingServiceRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		const bucket = this.rerankingServices.get(workspace) ?? new Map();
		if (bucket.has(uid)) {
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
		bucket.set(uid, record);
		this.rerankingServices.set(workspace, bucket);
		return record;
	}

	async updateRerankingService(
		workspace: string,
		uid: string,
		patch: UpdateRerankingServiceInput,
	): Promise<RerankingServiceRecord> {
		await this.assertWorkspace(workspace);
		const existing = this.rerankingServices.get(workspace)?.get(uid);
		if (!existing) {
			throw new ControlPlaneNotFoundError("reranking service", uid);
		}
		const next: RerankingServiceRecord = {
			...existing,
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.description !== undefined && {
				description: patch.description,
			}),
			...(patch.status !== undefined && { status: patch.status }),
			...(patch.provider !== undefined && { provider: patch.provider }),
			...(patch.engine !== undefined && { engine: patch.engine }),
			...(patch.modelName !== undefined && { modelName: patch.modelName }),
			...(patch.modelVersion !== undefined && {
				modelVersion: patch.modelVersion,
			}),
			...(patch.maxCandidates !== undefined && {
				maxCandidates: patch.maxCandidates,
			}),
			...(patch.scoringStrategy !== undefined && {
				scoringStrategy: patch.scoringStrategy,
			}),
			...(patch.scoreNormalized !== undefined && {
				scoreNormalized: patch.scoreNormalized,
			}),
			...(patch.returnScores !== undefined && {
				returnScores: patch.returnScores,
			}),
			...(patch.endpointBaseUrl !== undefined && {
				endpointBaseUrl: patch.endpointBaseUrl,
			}),
			...(patch.endpointPath !== undefined && {
				endpointPath: patch.endpointPath,
			}),
			...(patch.requestTimeoutMs !== undefined && {
				requestTimeoutMs: patch.requestTimeoutMs,
			}),
			...(patch.maxBatchSize !== undefined && {
				maxBatchSize: patch.maxBatchSize,
			}),
			...(patch.authType !== undefined && { authType: patch.authType }),
			...(patch.credentialRef !== undefined && {
				credentialRef: patch.credentialRef,
			}),
			...(patch.supportedLanguages !== undefined && {
				supportedLanguages: freezeStringSet(patch.supportedLanguages),
			}),
			...(patch.supportedContent !== undefined && {
				supportedContent: freezeStringSet(patch.supportedContent),
			}),
			updatedAt: nowIso(),
		};
		this.rerankingServices.get(workspace)?.set(uid, next);
		return next;
	}

	async deleteRerankingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		this.assertServiceNotReferenced(workspace, "rerankingServiceId", uid);
		return {
			deleted: this.rerankingServices.get(workspace)?.delete(uid) ?? false,
		};
	}

	/* ---------------- Helpers ---------------- */

	private async assertWorkspace(uid: string): Promise<void> {
		if (!this.workspaces.has(uid)) {
			throw new ControlPlaneNotFoundError("workspace", uid);
		}
	}

	private async assertKnowledgeBase(
		workspace: string,
		knowledgeBase: string,
	): Promise<void> {
		await this.assertWorkspace(workspace);
		if (!this.knowledgeBases.get(workspace)?.has(knowledgeBase)) {
			throw new ControlPlaneNotFoundError("knowledge base", knowledgeBase);
		}
	}

	private async assertChunkingService(
		workspace: string,
		uid: string,
	): Promise<void> {
		if (!this.chunkingServices.get(workspace)?.has(uid)) {
			throw new ControlPlaneNotFoundError("chunking service", uid);
		}
	}

	private async assertEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<void> {
		if (!this.embeddingServices.get(workspace)?.has(uid)) {
			throw new ControlPlaneNotFoundError("embedding service", uid);
		}
	}

	private async assertRerankingService(
		workspace: string,
		uid: string,
	): Promise<void> {
		if (!this.rerankingServices.get(workspace)?.has(uid)) {
			throw new ControlPlaneNotFoundError("reranking service", uid);
		}
	}

	/**
	 * Refuse to delete a service that any KB still references on the
	 * given field. Mirrors the pattern used for vector-store deletion.
	 */
	private assertServiceNotReferenced(
		workspace: string,
		field: "embeddingServiceId" | "chunkingServiceId" | "rerankingServiceId",
		serviceUid: string,
	): void {
		const ref = Array.from(
			this.knowledgeBases.get(workspace)?.values() ?? [],
		).find((kb) => kb[field] === serviceUid);
		if (ref) {
			throw new ControlPlaneConflictError(
				`service '${serviceUid}' is referenced by knowledge base '${ref.knowledgeBaseId}' (${field})`,
			);
		}
	}
}
