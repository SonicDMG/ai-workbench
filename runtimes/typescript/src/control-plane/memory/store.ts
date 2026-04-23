/**
 * In-memory {@link ../store.ControlPlaneStore}.
 *
 * Default backend for CI and `docker run` with no external dependencies.
 * Not durable — state is lost when the process exits.
 *
 * Internal layout mirrors the CQL partition structure:
 *   workspaces          : Map<workspaceUid, WorkspaceRecord>
 *   catalogs            : Map<workspaceUid, Map<catalogUid, CatalogRecord>>
 *   vectorStores        : Map<workspaceUid, Map<vectorStoreUid, VectorStoreRecord>>
 *   documents           : Map<`${workspaceUid}:${catalogUid}`, Map<docUid, DocumentRecord>>
 *
 * This keeps lookups O(log N) on JS's Map while matching the physical
 * storage semantics one-to-one.
 */

import { randomUUID } from "node:crypto";
import {
	byCreatedAtThenUid,
	DEFAULT_LEXICAL,
	DEFAULT_RERANKING,
	DEFAULT_SIMILARITY,
	nowIso,
} from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import type {
	ControlPlaneStore,
	CreateCatalogInput,
	CreateDocumentInput,
	CreateVectorStoreInput,
	CreateWorkspaceInput,
	UpdateCatalogInput,
	UpdateDocumentInput,
	UpdateVectorStoreInput,
	UpdateWorkspaceInput,
} from "../store.js";
import type {
	CatalogRecord,
	DocumentRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../types.js";

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
	private readonly catalogs = new Map<string, Map<string, CatalogRecord>>();
	private readonly vectorStores = new Map<
		string,
		Map<string, VectorStoreRecord>
	>();
	private readonly documents = new Map<string, Map<string, DocumentRecord>>();

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
		this.catalogs.delete(uid);
		this.vectorStores.delete(uid);
		for (const key of Array.from(this.documents.keys())) {
			if (key.startsWith(`${uid}:`)) this.documents.delete(key);
		}
		return { deleted };
	}

	/* ---------------- Catalogs ---------------- */

	async listCatalogs(workspace: string): Promise<readonly CatalogRecord[]> {
		await this.assertWorkspace(workspace);
		return Array.from(this.catalogs.get(workspace)?.values() ?? []);
	}

	async getCatalog(
		workspace: string,
		uid: string,
	): Promise<CatalogRecord | null> {
		await this.assertWorkspace(workspace);
		return this.catalogs.get(workspace)?.get(uid) ?? null;
	}

	async createCatalog(
		workspace: string,
		input: CreateCatalogInput,
	): Promise<CatalogRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		const bucket = this.catalogs.get(workspace) ?? new Map();
		if (bucket.has(uid)) {
			throw new ControlPlaneConflictError(
				`catalog with uid '${uid}' already exists in workspace '${workspace}'`,
			);
		}
		const now = nowIso();
		const record: CatalogRecord = {
			workspace,
			uid,
			name: input.name,
			description: input.description ?? null,
			vectorStore: input.vectorStore ?? null,
			createdAt: now,
			updatedAt: now,
		};
		bucket.set(uid, record);
		this.catalogs.set(workspace, bucket);
		return record;
	}

	async updateCatalog(
		workspace: string,
		uid: string,
		patch: UpdateCatalogInput,
	): Promise<CatalogRecord> {
		await this.assertWorkspace(workspace);
		const existing = this.catalogs.get(workspace)?.get(uid);
		if (!existing) {
			throw new ControlPlaneNotFoundError("catalog", uid);
		}
		const next: CatalogRecord = {
			...existing,
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.description !== undefined && {
				description: patch.description,
			}),
			...(patch.vectorStore !== undefined && {
				vectorStore: patch.vectorStore,
			}),
			updatedAt: nowIso(),
		};
		this.catalogs.get(workspace)?.set(uid, next);
		return next;
	}

	async deleteCatalog(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		const bucket = this.catalogs.get(workspace);
		const deleted = bucket?.delete(uid) ?? false;
		this.documents.delete(docKey(workspace, uid));
		return { deleted };
	}

	/* ---------------- Vector stores ---------------- */

	async listVectorStores(
		workspace: string,
	): Promise<readonly VectorStoreRecord[]> {
		await this.assertWorkspace(workspace);
		return Array.from(this.vectorStores.get(workspace)?.values() ?? []);
	}

	async getVectorStore(
		workspace: string,
		uid: string,
	): Promise<VectorStoreRecord | null> {
		await this.assertWorkspace(workspace);
		return this.vectorStores.get(workspace)?.get(uid) ?? null;
	}

	async createVectorStore(
		workspace: string,
		input: CreateVectorStoreInput,
	): Promise<VectorStoreRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		const bucket = this.vectorStores.get(workspace) ?? new Map();
		if (bucket.has(uid)) {
			throw new ControlPlaneConflictError(
				`vector store with uid '${uid}' already exists in workspace '${workspace}'`,
			);
		}
		const now = nowIso();
		const record: VectorStoreRecord = {
			workspace,
			uid,
			name: input.name,
			vectorDimension: input.vectorDimension,
			vectorSimilarity: input.vectorSimilarity ?? DEFAULT_SIMILARITY,
			embedding: input.embedding,
			lexical: input.lexical ?? DEFAULT_LEXICAL,
			reranking: input.reranking ?? DEFAULT_RERANKING,
			createdAt: now,
			updatedAt: now,
		};
		bucket.set(uid, record);
		this.vectorStores.set(workspace, bucket);
		return record;
	}

	async updateVectorStore(
		workspace: string,
		uid: string,
		patch: UpdateVectorStoreInput,
	): Promise<VectorStoreRecord> {
		await this.assertWorkspace(workspace);
		const existing = this.vectorStores.get(workspace)?.get(uid);
		if (!existing) {
			throw new ControlPlaneNotFoundError("vector store", uid);
		}
		const next: VectorStoreRecord = {
			...existing,
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.vectorDimension !== undefined && {
				vectorDimension: patch.vectorDimension,
			}),
			...(patch.vectorSimilarity !== undefined && {
				vectorSimilarity: patch.vectorSimilarity,
			}),
			...(patch.embedding !== undefined && { embedding: patch.embedding }),
			...(patch.lexical !== undefined && { lexical: patch.lexical }),
			...(patch.reranking !== undefined && { reranking: patch.reranking }),
			updatedAt: nowIso(),
		};
		this.vectorStores.get(workspace)?.set(uid, next);
		return next;
	}

	async deleteVectorStore(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		return {
			deleted: this.vectorStores.get(workspace)?.delete(uid) ?? false,
		};
	}

	/* ---------------- Documents ---------------- */

	async listDocuments(
		workspace: string,
		catalog: string,
	): Promise<readonly DocumentRecord[]> {
		await this.assertCatalog(workspace, catalog);
		return Array.from(
			this.documents.get(docKey(workspace, catalog))?.values() ?? [],
		);
	}

	async getDocument(
		workspace: string,
		catalog: string,
		uid: string,
	): Promise<DocumentRecord | null> {
		await this.assertCatalog(workspace, catalog);
		return this.documents.get(docKey(workspace, catalog))?.get(uid) ?? null;
	}

	async createDocument(
		workspace: string,
		catalog: string,
		input: CreateDocumentInput,
	): Promise<DocumentRecord> {
		await this.assertCatalog(workspace, catalog);
		const key = docKey(workspace, catalog);
		const uid = input.uid ?? randomUUID();
		const bucket = this.documents.get(key) ?? new Map();
		if (bucket.has(uid)) {
			throw new ControlPlaneConflictError(
				`document with uid '${uid}' already exists in catalog '${catalog}'`,
			);
		}
		const now = nowIso();
		const record: DocumentRecord = {
			workspace,
			catalogUid: catalog,
			documentUid: uid,
			sourceDocId: input.sourceDocId ?? null,
			sourceFilename: input.sourceFilename ?? null,
			fileType: input.fileType ?? null,
			fileSize: input.fileSize ?? null,
			md5Hash: input.md5Hash ?? null,
			chunkTotal: input.chunkTotal ?? null,
			ingestedAt: input.ingestedAt ?? null,
			updatedAt: now,
			status: input.status ?? "pending",
			errorMessage: input.errorMessage ?? null,
			metadata: freezeMetadata(input.metadata),
		};
		bucket.set(uid, record);
		this.documents.set(key, bucket);
		return record;
	}

	async updateDocument(
		workspace: string,
		catalog: string,
		uid: string,
		patch: UpdateDocumentInput,
	): Promise<DocumentRecord> {
		await this.assertCatalog(workspace, catalog);
		const key = docKey(workspace, catalog);
		const existing = this.documents.get(key)?.get(uid);
		if (!existing) {
			throw new ControlPlaneNotFoundError("document", uid);
		}
		const next: DocumentRecord = {
			...existing,
			...(patch.sourceDocId !== undefined && {
				sourceDocId: patch.sourceDocId,
			}),
			...(patch.sourceFilename !== undefined && {
				sourceFilename: patch.sourceFilename,
			}),
			...(patch.fileType !== undefined && { fileType: patch.fileType }),
			...(patch.fileSize !== undefined && { fileSize: patch.fileSize }),
			...(patch.md5Hash !== undefined && { md5Hash: patch.md5Hash }),
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
		this.documents.get(key)?.set(uid, next);
		return next;
	}

	async deleteDocument(
		workspace: string,
		catalog: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertCatalog(workspace, catalog);
		return {
			deleted:
				this.documents.get(docKey(workspace, catalog))?.delete(uid) ?? false,
		};
	}

	/* ---------------- Helpers ---------------- */

	private async assertWorkspace(uid: string): Promise<void> {
		if (!this.workspaces.has(uid)) {
			throw new ControlPlaneNotFoundError("workspace", uid);
		}
	}

	private async assertCatalog(
		workspace: string,
		catalog: string,
	): Promise<void> {
		await this.assertWorkspace(workspace);
		if (!this.catalogs.get(workspace)?.has(catalog)) {
			throw new ControlPlaneNotFoundError("catalog", catalog);
		}
	}
}
