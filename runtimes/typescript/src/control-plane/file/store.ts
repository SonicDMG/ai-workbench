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
import { Mutex } from "./mutex.js";

type Table =
	| "workspaces"
	| "api-keys"
	// Knowledge-base schema (issue #98).
	| "knowledge-bases"
	| "chunking-services"
	| "embedding-services"
	| "reranking-services"
	| "rag-documents";

const TABLE_FILES: Record<Table, string> = {
	workspaces: "workspaces.json",
	"api-keys": "api-keys.json",
	"knowledge-bases": "knowledge-bases.json",
	"chunking-services": "chunking-services.json",
	"embedding-services": "embedding-services.json",
	"reranking-services": "reranking-services.json",
	"rag-documents": "rag-documents.json",
};

function freezeStringSet(
	value: ReadonlySet<string> | readonly string[] | undefined,
): readonly string[] {
	return Object.freeze([...new Set(value ?? [])].sort());
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
		"chunking-services": new Mutex(),
		"embedding-services": new Mutex(),
		"reranking-services": new Mutex(),
		"rag-documents": new Mutex(),
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
				endpoint: input.endpoint ?? null,
				kind: input.kind,
				credentialsRef: { ...(input.credentialsRef ?? {}) },
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
				...(patch.endpoint !== undefined && { endpoint: patch.endpoint }),
				...(patch.credentialsRef !== undefined && {
					credentialsRef: { ...patch.credentialsRef },
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
		await this.mutate<"rag-documents", null>("rag-documents", (rows) => ({
			rows: rows.filter((d) => d.workspaceId !== uid),
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
		return res;
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
			: K extends "chunking-services"
				? ChunkingServiceRecord
				: K extends "embedding-services"
					? EmbeddingServiceRecord
					: K extends "reranking-services"
						? RerankingServiceRecord
						: K extends "rag-documents"
							? RagDocumentRecord
							: never;
