/**
 * JSON-on-disk {@link ../store.ControlPlaneStore} for single-node
 * self-hosted deployments.
 *
 * Layout:
 *   <root>/workspaces.json       : WorkspaceRecord[]
 *   <root>/catalogs.json         : CatalogRecord[]
 *   <root>/vector-stores.json    : VectorStoreRecord[]
 *   <root>/documents.json        : DocumentRecord[]
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
	PersistApiKeyInput,
	UpdateCatalogInput,
	UpdateDocumentInput,
	UpdateVectorStoreInput,
	UpdateWorkspaceInput,
} from "../store.js";
import type {
	ApiKeyRecord,
	CatalogRecord,
	DocumentRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../types.js";
import { Mutex } from "./mutex.js";

type Table =
	| "workspaces"
	| "catalogs"
	| "vector-stores"
	| "documents"
	| "api-keys";

const TABLE_FILES: Record<Table, string> = {
	workspaces: "workspaces.json",
	catalogs: "catalogs.json",
	"vector-stores": "vector-stores.json",
	documents: "documents.json",
	"api-keys": "api-keys.json",
};

export interface FileControlPlaneOptions {
	readonly root: string;
}

export class FileControlPlaneStore implements ControlPlaneStore {
	private readonly root: string;
	private readonly mutexes: Record<Table, Mutex> = {
		workspaces: new Mutex(),
		catalogs: new Mutex(),
		"vector-stores": new Mutex(),
		documents: new Mutex(),
		"api-keys": new Mutex(),
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

		await this.mutate<"catalogs", null>("catalogs", (rows) => ({
			rows: rows.filter((c) => c.workspace !== uid),
			result: null,
		}));
		await this.mutate<"vector-stores", null>("vector-stores", (rows) => ({
			rows: rows.filter((v) => v.workspace !== uid),
			result: null,
		}));
		await this.mutate<"documents", null>("documents", (rows) => ({
			rows: rows.filter((d) => d.workspace !== uid),
			result: null,
		}));
		await this.mutate<"api-keys", null>("api-keys", (rows) => ({
			rows: rows.filter((k) => k.workspace !== uid),
			result: null,
		}));

		return workspaceDeleted;
	}

	/* ---------------- Catalogs ---------------- */

	async listCatalogs(workspace: string): Promise<readonly CatalogRecord[]> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<CatalogRecord>("catalogs");
		return all.filter((c) => c.workspace === workspace);
	}

	async getCatalog(
		workspace: string,
		uid: string,
	): Promise<CatalogRecord | null> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<CatalogRecord>("catalogs");
		return all.find((c) => c.workspace === workspace && c.uid === uid) ?? null;
	}

	async createCatalog(
		workspace: string,
		input: CreateCatalogInput,
	): Promise<CatalogRecord> {
		await this.assertWorkspace(workspace);
		if (input.vectorStore !== undefined && input.vectorStore !== null) {
			await this.assertVectorStore(workspace, input.vectorStore);
		}
		return this.mutate<"catalogs", CatalogRecord>("catalogs", (rows) => {
			const uid = input.uid ?? randomUUID();
			if (rows.some((c) => c.workspace === workspace && c.uid === uid)) {
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
			return { rows: [...rows, record], result: record };
		});
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
		return this.mutate<"catalogs", CatalogRecord>("catalogs", (rows) => {
			const idx = rows.findIndex(
				(c) => c.workspace === workspace && c.uid === uid,
			);
			if (idx < 0) {
				throw new ControlPlaneNotFoundError("catalog", uid);
			}
			const existing = rows[idx] as CatalogRecord;
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
			const nextRows = [...rows];
			nextRows[idx] = next;
			return { rows: nextRows, result: next };
		});
	}

	async deleteCatalog(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		const res = await this.mutate<"catalogs", { deleted: boolean }>(
			"catalogs",
			(rows) => {
				const next = rows.filter(
					(c) => !(c.workspace === workspace && c.uid === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
		// Cascade: drop documents in this catalog.
		await this.mutate<"documents", null>("documents", (rows) => ({
			rows: rows.filter(
				(d) => !(d.workspace === workspace && d.catalogUid === uid),
			),
			result: null,
		}));
		return res;
	}

	/* ---------------- Vector stores ---------------- */

	async listVectorStores(
		workspace: string,
	): Promise<readonly VectorStoreRecord[]> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<VectorStoreRecord>("vector-stores");
		return all.filter((v) => v.workspace === workspace);
	}

	async getVectorStore(
		workspace: string,
		uid: string,
	): Promise<VectorStoreRecord | null> {
		await this.assertWorkspace(workspace);
		const all = await this.readAll<VectorStoreRecord>("vector-stores");
		return all.find((v) => v.workspace === workspace && v.uid === uid) ?? null;
	}

	async createVectorStore(
		workspace: string,
		input: CreateVectorStoreInput,
	): Promise<VectorStoreRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"vector-stores", VectorStoreRecord>(
			"vector-stores",
			(rows) => {
				const uid = input.uid ?? randomUUID();
				if (rows.some((v) => v.workspace === workspace && v.uid === uid)) {
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
				return { rows: [...rows, record], result: record };
			},
		);
	}

	async updateVectorStore(
		workspace: string,
		uid: string,
		patch: UpdateVectorStoreInput,
	): Promise<VectorStoreRecord> {
		await this.assertWorkspace(workspace);
		return this.mutate<"vector-stores", VectorStoreRecord>(
			"vector-stores",
			(rows) => {
				const idx = rows.findIndex(
					(v) => v.workspace === workspace && v.uid === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("vector store", uid);
				}
				const existing = rows[idx] as VectorStoreRecord;
				const next: VectorStoreRecord = {
					...existing,
					...(patch.name !== undefined && { name: patch.name }),
					...(patch.vectorDimension !== undefined && {
						vectorDimension: patch.vectorDimension,
					}),
					...(patch.vectorSimilarity !== undefined && {
						vectorSimilarity: patch.vectorSimilarity,
					}),
					...(patch.embedding !== undefined && {
						embedding: patch.embedding,
					}),
					...(patch.lexical !== undefined && { lexical: patch.lexical }),
					...(patch.reranking !== undefined && {
						reranking: patch.reranking,
					}),
					updatedAt: nowIso(),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			},
		);
	}

	async deleteVectorStore(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertWorkspace(workspace);
		await this.assertVectorStoreNotReferenced(workspace, uid);
		return this.mutate<"vector-stores", { deleted: boolean }>(
			"vector-stores",
			(rows) => {
				const next = rows.filter(
					(v) => !(v.workspace === workspace && v.uid === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
	}

	/* ---------------- Documents ---------------- */

	async listDocuments(
		workspace: string,
		catalog: string,
	): Promise<readonly DocumentRecord[]> {
		await this.assertCatalog(workspace, catalog);
		const all = await this.readAll<DocumentRecord>("documents");
		return all.filter(
			(d) => d.workspace === workspace && d.catalogUid === catalog,
		);
	}

	async getDocument(
		workspace: string,
		catalog: string,
		uid: string,
	): Promise<DocumentRecord | null> {
		await this.assertCatalog(workspace, catalog);
		const all = await this.readAll<DocumentRecord>("documents");
		return (
			all.find(
				(d) =>
					d.workspace === workspace &&
					d.catalogUid === catalog &&
					d.documentUid === uid,
			) ?? null
		);
	}

	async createDocument(
		workspace: string,
		catalog: string,
		input: CreateDocumentInput,
	): Promise<DocumentRecord> {
		await this.assertCatalog(workspace, catalog);
		return this.mutate<"documents", DocumentRecord>("documents", (rows) => {
			const uid = input.uid ?? randomUUID();
			if (
				rows.some(
					(d) =>
						d.workspace === workspace &&
						d.catalogUid === catalog &&
						d.documentUid === uid,
				)
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
			return { rows: [...rows, record], result: record };
		});
	}

	async updateDocument(
		workspace: string,
		catalog: string,
		uid: string,
		patch: UpdateDocumentInput,
	): Promise<DocumentRecord> {
		await this.assertCatalog(workspace, catalog);
		return this.mutate<"documents", DocumentRecord>("documents", (rows) => {
			const idx = rows.findIndex(
				(d) =>
					d.workspace === workspace &&
					d.catalogUid === catalog &&
					d.documentUid === uid,
			);
			if (idx < 0) {
				throw new ControlPlaneNotFoundError("document", uid);
			}
			const existing = rows[idx] as DocumentRecord;
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
		});
	}

	async deleteDocument(
		workspace: string,
		catalog: string,
		uid: string,
	): Promise<{ deleted: boolean }> {
		await this.assertCatalog(workspace, catalog);
		return this.mutate<"documents", { deleted: boolean }>(
			"documents",
			(rows) => {
				const next = rows.filter(
					(d) =>
						!(
							d.workspace === workspace &&
							d.catalogUid === catalog &&
							d.documentUid === uid
						),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			},
		);
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

	private async assertCatalog(
		workspace: string,
		catalog: string,
	): Promise<void> {
		await this.assertWorkspace(workspace);
		const cat = await this.getCatalog(workspace, catalog);
		if (!cat) {
			throw new ControlPlaneNotFoundError("catalog", catalog);
		}
	}

	private async assertVectorStore(
		workspace: string,
		vectorStore: string,
	): Promise<void> {
		await this.assertWorkspace(workspace);
		const vs = await this.getVectorStore(workspace, vectorStore);
		if (!vs) {
			throw new ControlPlaneNotFoundError("vector store", vectorStore);
		}
	}

	private async assertVectorStoreNotReferenced(
		workspace: string,
		vectorStore: string,
	): Promise<void> {
		const catalogs = await this.readAll<CatalogRecord>("catalogs");
		const ref = catalogs.find(
			(c) => c.workspace === workspace && c.vectorStore === vectorStore,
		);
		if (ref) {
			throw new ControlPlaneConflictError(
				`vector store '${vectorStore}' is referenced by catalog '${ref.uid}'`,
			);
		}
	}
}

type TableRow<K extends Table> = K extends "workspaces"
	? WorkspaceRecord
	: K extends "catalogs"
		? CatalogRecord
		: K extends "vector-stores"
			? VectorStoreRecord
			: K extends "documents"
				? DocumentRecord
				: K extends "api-keys"
					? ApiKeyRecord
					: never;
