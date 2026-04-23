/**
 * {@link ../store.ControlPlaneStore} backed by Astra Data API Tables.
 *
 * Holds no state of its own — every operation is a `findOne`,
 * `insertOne`, `updateOne`, or `deleteOne` against the four `wb_*`
 * tables declared in {@link ../../astra-client/table-definitions.ts}.
 *
 * Error mapping contract:
 *   - `findOne` → null  → {@link ControlPlaneNotFoundError} on the
 *     relevant method.
 *   - Insert of a PK that already exists → {@link ControlPlaneConflictError}.
 *     (Astra's insert into Tables is upsert-by-default, so we check
 *     existence first. Race windows are accepted for now — Phase 1a
 *     targets correctness for single-writer scenarios; the route layer
 *     will add a retry policy in Phase 1a.3 if needed.)
 *
 * Cascade semantics:
 *   - `deleteWorkspace` → `deleteMany` on catalogs/vector stores/documents
 *     scoped by workspace. Accepted: partial failure across partitions
 *     (no cross-partition transaction). Behavior matches the `file`
 *     backend we shipped earlier.
 *   - `deleteCatalog` → `deleteMany` on documents scoped by
 *     (workspace, catalogUid).
 */

import { randomUUID } from "node:crypto";
import {
	catalogFromRow,
	catalogToRow,
	documentFromRow,
	documentToRow,
	vectorStoreFromRow,
	vectorStoreToRow,
	workspaceFromRow,
	workspaceToRow,
} from "../../astra-client/converters.js";
import type { TablesBundle } from "../../astra-client/tables.js";
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
			credentialsRef: { ...(input.credentialsRef ?? {}) },
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
			...(patch.credentialsRef !== undefined && {
				credentialsRef: { ...patch.credentialsRef },
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
		await this.tables.workspaces.deleteOne({ uid });
		await Promise.all([
			this.tables.catalogs.deleteMany({ workspace: uid }),
			this.tables.vectorStores.deleteMany({ workspace: uid }),
			this.tables.documents.deleteMany({ workspace: uid }),
		]);
		return { deleted: true };
	}

	/* ---------------- Catalogs ---------------- */

	async listCatalogs(workspace: string): Promise<readonly CatalogRecord[]> {
		await this.assertWorkspace(workspace);
		const rows = await this.tables.catalogs.find({ workspace }).toArray();
		return rows.map(catalogFromRow);
	}

	async getCatalog(
		workspace: string,
		uid: string,
	): Promise<CatalogRecord | null> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.catalogs.findOne({ workspace, uid });
		return row ? catalogFromRow(row) : null;
	}

	async createCatalog(
		workspace: string,
		input: CreateCatalogInput,
	): Promise<CatalogRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		if (await this.tables.catalogs.findOne({ workspace, uid })) {
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
		await this.tables.catalogs.insertOne(catalogToRow(record));
		return record;
	}

	async updateCatalog(
		workspace: string,
		uid: string,
		patch: UpdateCatalogInput,
	): Promise<CatalogRecord> {
		await this.assertWorkspace(workspace);
		const existing = await this.tables.catalogs.findOne({ workspace, uid });
		if (!existing) throw new ControlPlaneNotFoundError("catalog", uid);
		const base = catalogFromRow(existing);
		const next: CatalogRecord = {
			...base,
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.description !== undefined && {
				description: patch.description,
			}),
			...(patch.vectorStore !== undefined && {
				vectorStore: patch.vectorStore,
			}),
			updatedAt: nowIso(),
		};
		const nextRow = catalogToRow(next);
		const { workspace: _w, uid: _u, ...fields } = nextRow;
		await this.tables.catalogs.updateOne({ workspace, uid }, { $set: fields });
		return next;
	}

	async deleteCatalog(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		const existing = await this.tables.catalogs.findOne({ workspace, uid });
		if (!existing) return { deleted: false };
		await this.tables.catalogs.deleteOne({ workspace, uid });
		await this.tables.documents.deleteMany({
			workspace,
			catalog_uid: uid,
		});
		return { deleted: true };
	}

	/* ---------------- Vector stores ---------------- */

	async listVectorStores(
		workspace: string,
	): Promise<readonly VectorStoreRecord[]> {
		await this.assertWorkspace(workspace);
		const rows = await this.tables.vectorStores.find({ workspace }).toArray();
		return rows.map(vectorStoreFromRow);
	}

	async getVectorStore(
		workspace: string,
		uid: string,
	): Promise<VectorStoreRecord | null> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.vectorStores.findOne({ workspace, uid });
		return row ? vectorStoreFromRow(row) : null;
	}

	async createVectorStore(
		workspace: string,
		input: CreateVectorStoreInput,
	): Promise<VectorStoreRecord> {
		await this.assertWorkspace(workspace);
		const uid = input.uid ?? randomUUID();
		if (await this.tables.vectorStores.findOne({ workspace, uid })) {
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
		await this.tables.vectorStores.insertOne(vectorStoreToRow(record));
		return record;
	}

	async updateVectorStore(
		workspace: string,
		uid: string,
		patch: UpdateVectorStoreInput,
	): Promise<VectorStoreRecord> {
		await this.assertWorkspace(workspace);
		const existing = await this.tables.vectorStores.findOne({ workspace, uid });
		if (!existing) throw new ControlPlaneNotFoundError("vector store", uid);
		const base = vectorStoreFromRow(existing);
		const next: VectorStoreRecord = {
			...base,
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
		const nextRow = vectorStoreToRow(next);
		const { workspace: _w, uid: _u, ...fields } = nextRow;
		await this.tables.vectorStores.updateOne(
			{ workspace, uid },
			{ $set: fields },
		);
		return next;
	}

	async deleteVectorStore(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		const existing = await this.tables.vectorStores.findOne({ workspace, uid });
		if (!existing) return { deleted: false };
		await this.tables.vectorStores.deleteOne({ workspace, uid });
		return { deleted: true };
	}

	/* ---------------- Documents ---------------- */

	async listDocuments(
		workspace: string,
		catalog: string,
	): Promise<readonly DocumentRecord[]> {
		await this.assertCatalog(workspace, catalog);
		const rows = await this.tables.documents
			.find({ workspace, catalog_uid: catalog })
			.toArray();
		return rows.map(documentFromRow);
	}

	async getDocument(
		workspace: string,
		catalog: string,
		uid: string,
	): Promise<DocumentRecord | null> {
		await this.assertCatalog(workspace, catalog);
		const row = await this.tables.documents.findOne({
			workspace,
			catalog_uid: catalog,
			document_uid: uid,
		});
		return row ? documentFromRow(row) : null;
	}

	async createDocument(
		workspace: string,
		catalog: string,
		input: CreateDocumentInput,
	): Promise<DocumentRecord> {
		await this.assertCatalog(workspace, catalog);
		const uid = input.uid ?? randomUUID();
		if (
			await this.tables.documents.findOne({
				workspace,
				catalog_uid: catalog,
				document_uid: uid,
			})
		) {
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
			metadata: { ...(input.metadata ?? {}) },
		};
		await this.tables.documents.insertOne(documentToRow(record));
		return record;
	}

	async updateDocument(
		workspace: string,
		catalog: string,
		uid: string,
		patch: UpdateDocumentInput,
	): Promise<DocumentRecord> {
		await this.assertCatalog(workspace, catalog);
		const existing = await this.tables.documents.findOne({
			workspace,
			catalog_uid: catalog,
			document_uid: uid,
		});
		if (!existing) throw new ControlPlaneNotFoundError("document", uid);
		const base = documentFromRow(existing);
		const next: DocumentRecord = {
			...base,
			...(patch.sourceDocId !== undefined && {
				sourceDocId: patch.sourceDocId,
			}),
			...(patch.sourceFilename !== undefined && {
				sourceFilename: patch.sourceFilename,
			}),
			...(patch.fileType !== undefined && { fileType: patch.fileType }),
			...(patch.fileSize !== undefined && { fileSize: patch.fileSize }),
			...(patch.md5Hash !== undefined && { md5Hash: patch.md5Hash }),
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
		const nextRow = documentToRow(next);
		const {
			workspace: _w,
			catalog_uid: _c,
			document_uid: _d,
			...fields
		} = nextRow;
		await this.tables.documents.updateOne(
			{ workspace, catalog_uid: catalog, document_uid: uid },
			{ $set: fields },
		);
		return next;
	}

	async deleteDocument(
		workspace: string,
		catalog: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertCatalog(workspace, catalog);
		const existing = await this.tables.documents.findOne({
			workspace,
			catalog_uid: catalog,
			document_uid: uid,
		});
		if (!existing) return { deleted: false };
		await this.tables.documents.deleteOne({
			workspace,
			catalog_uid: catalog,
			document_uid: uid,
		});
		return { deleted: true };
	}

	/* ---------------- Helpers ---------------- */

	private async assertWorkspace(uid: string): Promise<void> {
		const row = await this.tables.workspaces.findOne({ uid });
		if (!row) throw new ControlPlaneNotFoundError("workspace", uid);
	}

	private async assertCatalog(
		workspace: string,
		catalog: string,
	): Promise<void> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.catalogs.findOne({
			workspace,
			uid: catalog,
		});
		if (!row) throw new ControlPlaneNotFoundError("catalog", catalog);
	}
}
