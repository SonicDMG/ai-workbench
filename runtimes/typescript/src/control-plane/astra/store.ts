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
	apiKeyFromRow,
	apiKeyToRow,
	catalogFromRow,
	catalogToRow,
	documentFromRow,
	documentToRow,
	savedQueryFromRow,
	savedQueryToRow,
	vectorStoreFromRow,
	vectorStoreToRow,
	workspaceFromRow,
	workspaceToRow,
} from "../../astra-client/converters.js";
import type { TablesBundle } from "../../astra-client/tables.js";
import {
	assertVectorStorePatchIsEmpty,
	byCreatedAtThenKeyId,
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
	CreateSavedQueryInput,
	CreateVectorStoreInput,
	CreateWorkspaceInput,
	PersistApiKeyInput,
	UpdateCatalogInput,
	UpdateDocumentInput,
	UpdateSavedQueryInput,
	UpdateVectorStoreInput,
	UpdateWorkspaceInput,
} from "../store.js";
import type {
	ApiKeyRecord,
	CatalogRecord,
	DocumentRecord,
	SavedQueryRecord,
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
			endpoint: input.endpoint ?? null,
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
			...(patch.endpoint !== undefined && { endpoint: patch.endpoint }),
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
			this.tables.catalogs.deleteMany({ workspace: uid }),
			this.tables.vectorStores.deleteMany({ workspace: uid }),
			this.tables.documents.deleteMany({ workspace: uid }),
			this.tables.savedQueries.deleteMany({ workspace: uid }),
			this.tables.apiKeys.deleteMany({ workspace: uid }),
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
		if (input.vectorStore !== undefined && input.vectorStore !== null) {
			await this.assertVectorStore(workspace, input.vectorStore);
		}
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
		if (patch.vectorStore !== undefined && patch.vectorStore !== null) {
			await this.assertVectorStore(workspace, patch.vectorStore);
		}
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
		await Promise.all([
			this.tables.documents.deleteMany({ workspace, catalog_uid: uid }),
			this.tables.savedQueries.deleteMany({ workspace, catalog_uid: uid }),
		]);
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
		assertVectorStorePatchIsEmpty(patch);
		return vectorStoreFromRow(existing);
	}

	async deleteVectorStore(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		await this.assertVectorStoreNotReferenced(workspace, uid);
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

	/* ---------------- Saved queries ---------------- */

	async listSavedQueries(
		workspace: string,
		catalog: string,
	): Promise<readonly SavedQueryRecord[]> {
		await this.assertCatalog(workspace, catalog);
		const rows = await this.tables.savedQueries
			.find({ workspace, catalog_uid: catalog })
			.toArray();
		return rows.map(savedQueryFromRow);
	}

	async getSavedQuery(
		workspace: string,
		catalog: string,
		uid: string,
	): Promise<SavedQueryRecord | null> {
		await this.assertCatalog(workspace, catalog);
		const row = await this.tables.savedQueries.findOne({
			workspace,
			catalog_uid: catalog,
			query_uid: uid,
		});
		return row ? savedQueryFromRow(row) : null;
	}

	async createSavedQuery(
		workspace: string,
		catalog: string,
		input: CreateSavedQueryInput,
	): Promise<SavedQueryRecord> {
		await this.assertCatalog(workspace, catalog);
		const uid = input.uid ?? randomUUID();
		if (
			await this.tables.savedQueries.findOne({
				workspace,
				catalog_uid: catalog,
				query_uid: uid,
			})
		) {
			throw new ControlPlaneConflictError(
				`saved query with uid '${uid}' already exists in catalog '${catalog}'`,
			);
		}
		const now = nowIso();
		const record: SavedQueryRecord = {
			workspace,
			catalogUid: catalog,
			queryUid: uid,
			name: input.name,
			description: input.description ?? null,
			text: input.text,
			topK: input.topK ?? null,
			filter: input.filter ? { ...input.filter } : null,
			createdAt: now,
			updatedAt: now,
		};
		await this.tables.savedQueries.insertOne(savedQueryToRow(record));
		return record;
	}

	async updateSavedQuery(
		workspace: string,
		catalog: string,
		uid: string,
		patch: UpdateSavedQueryInput,
	): Promise<SavedQueryRecord> {
		await this.assertCatalog(workspace, catalog);
		const existing = await this.tables.savedQueries.findOne({
			workspace,
			catalog_uid: catalog,
			query_uid: uid,
		});
		if (!existing) throw new ControlPlaneNotFoundError("saved query", uid);
		const base = savedQueryFromRow(existing);
		const next: SavedQueryRecord = {
			...base,
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.description !== undefined && {
				description: patch.description,
			}),
			...(patch.text !== undefined && { text: patch.text }),
			...(patch.topK !== undefined && { topK: patch.topK }),
			...(patch.filter !== undefined && {
				filter: patch.filter ? { ...patch.filter } : null,
			}),
			updatedAt: nowIso(),
		};
		const nextRow = savedQueryToRow(next);
		const {
			workspace: _w,
			catalog_uid: _c,
			query_uid: _q,
			...fields
		} = nextRow;
		await this.tables.savedQueries.updateOne(
			{ workspace, catalog_uid: catalog, query_uid: uid },
			{ $set: fields },
		);
		return next;
	}

	async deleteSavedQuery(
		workspace: string,
		catalog: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertCatalog(workspace, catalog);
		const existing = await this.tables.savedQueries.findOne({
			workspace,
			catalog_uid: catalog,
			query_uid: uid,
		});
		if (!existing) return { deleted: false };
		await this.tables.savedQueries.deleteOne({
			workspace,
			catalog_uid: catalog,
			query_uid: uid,
		});
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

	private async assertVectorStore(
		workspace: string,
		vectorStore: string,
	): Promise<void> {
		await this.assertWorkspace(workspace);
		const row = await this.tables.vectorStores.findOne({
			workspace,
			uid: vectorStore,
		});
		if (!row) throw new ControlPlaneNotFoundError("vector store", vectorStore);
	}

	private async assertVectorStoreNotReferenced(
		workspace: string,
		vectorStore: string,
	): Promise<void> {
		const catalogs = await this.tables.catalogs.find({ workspace }).toArray();
		const ref = catalogs.find((c) => c.vector_store === vectorStore);
		if (ref) {
			throw new ControlPlaneConflictError(
				`vector store '${vectorStore}' is referenced by catalog '${ref.uid}'`,
			);
		}
	}
}
