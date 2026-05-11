/**
 * Shared on-disk state for {@link ./store.FileControlPlaneStore}.
 *
 * The file backend holds no in-memory record maps — every read goes
 * through `readAll`, every write through `mutate`. What this state
 * carries is the per-table mutex map, the JSON file plumbing, and the
 * cross-aggregate assertion helpers that the per-aggregate slice files
 * compose into their own logic.
 *
 * Each slice receives the single shared {@link FileStoreState} object
 * and uses its `readAll` / `mutate` helpers exclusively. Cross-aggregate
 * cascades (e.g. `deleteWorkspace`) reach into other tables through the
 * same helpers, which means each cascade independently acquires the
 * relevant per-file mutex — the exact behavior of the pre-split
 * monolith.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ControlPlaneNotFoundError } from "../errors.js";
import {
	type AgentServiceReferenceField,
	type KnowledgeBaseServiceReferenceField,
	serviceReferencedByAgent,
	serviceReferencedByKnowledgeBase,
} from "../shared/service-references.js";
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

/** Discriminator for the on-disk table set. */
export type Table =
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

/** Map table discriminator to its row type. */
export type TableRow<K extends Table> = K extends "workspaces"
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

export const TABLE_FILES: Record<Table, string> = {
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

/**
 * Shared file-backed state. Holds the per-table mutex map, the root
 * directory, and bound `readAll` / `mutate` helpers that each slice
 * uses for all I/O.
 */
export interface FileStoreState {
	readonly root: string;
	readonly mutexes: Record<Table, Mutex>;
	readAll<K extends Table>(table: K): Promise<TableRow<K>[]>;
	mutate<K extends Table, R>(
		table: K,
		fn: (rows: ReadonlyArray<TableRow<K>>) => {
			rows: readonly TableRow<K>[];
			result: R;
		},
	): Promise<R>;
}

function createMutexes(): Record<Table, Mutex> {
	return {
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
}

/**
 * Build a fresh {@link FileStoreState} for the given root directory.
 * The returned object closes over its own mutex map and root path so
 * each slice can call `state.readAll` / `state.mutate` directly.
 */
export function createFileStoreState(root: string): FileStoreState {
	const mutexes = createMutexes();

	async function readAll<K extends Table>(table: K): Promise<TableRow<K>[]> {
		const path = join(root, TABLE_FILES[table]);
		try {
			const raw = await readFile(path, "utf8");
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				throw new Error(`control-plane file '${path}' is not a JSON array`);
			}
			return parsed as TableRow<K>[];
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw err;
		}
	}

	async function writeAll<K extends Table>(
		table: K,
		rows: readonly TableRow<K>[],
	): Promise<void> {
		await mkdir(root, { recursive: true });
		const finalPath = join(root, TABLE_FILES[table]);
		const tmpPath = `${finalPath}.${randomUUID()}.tmp`;
		await writeFile(tmpPath, JSON.stringify(rows, null, 2), "utf8");
		await rename(tmpPath, finalPath);
	}

	async function mutate<K extends Table, R>(
		table: K,
		fn: (rows: ReadonlyArray<TableRow<K>>) => {
			rows: readonly TableRow<K>[];
			result: R;
		},
	): Promise<R> {
		return mutexes[table].run(async () => {
			const rows = await readAll(table);
			const { rows: nextRows, result } = fn(rows);
			await writeAll(table, nextRows);
			return result;
		});
	}

	return {
		root,
		mutexes,
		readAll,
		mutate,
	};
}

/* ---------------- Cross-aggregate assertions ---------------- */

/**
 * Throw {@link ControlPlaneNotFoundError} if the workspace row is
 * absent on disk.
 */
export async function assertWorkspace(
	state: FileStoreState,
	uid: string,
): Promise<void> {
	const rows = await state.readAll("workspaces");
	if (!rows.some((w) => w.uid === uid)) {
		throw new ControlPlaneNotFoundError("workspace", uid);
	}
}

export async function assertKnowledgeBase(
	state: FileStoreState,
	workspace: string,
	knowledgeBase: string,
): Promise<void> {
	await assertWorkspace(state, workspace);
	const rows = await state.readAll("knowledge-bases");
	const found = rows.some(
		(kb) =>
			kb.workspaceId === workspace && kb.knowledgeBaseId === knowledgeBase,
	);
	if (!found) {
		throw new ControlPlaneNotFoundError("knowledge base", knowledgeBase);
	}
}

export async function assertChunkingService(
	state: FileStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	const rows = await state.readAll("chunking-services");
	if (
		!rows.some(
			(s) => s.workspaceId === workspace && s.chunkingServiceId === uid,
		)
	) {
		throw new ControlPlaneNotFoundError("chunking service", uid);
	}
}

export async function assertEmbeddingService(
	state: FileStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	const rows = await state.readAll("embedding-services");
	if (
		!rows.some(
			(s) => s.workspaceId === workspace && s.embeddingServiceId === uid,
		)
	) {
		throw new ControlPlaneNotFoundError("embedding service", uid);
	}
}

export async function assertRerankingService(
	state: FileStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	const rows = await state.readAll("reranking-services");
	if (
		!rows.some(
			(s) => s.workspaceId === workspace && s.rerankingServiceId === uid,
		)
	) {
		throw new ControlPlaneNotFoundError("reranking service", uid);
	}
}

export async function assertLlmService(
	state: FileStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	const rows = await state.readAll("llm-services");
	if (
		!rows.some((s) => s.workspaceId === workspace && s.llmServiceId === uid)
	) {
		throw new ControlPlaneNotFoundError("llm service", uid);
	}
}

export async function assertAgent(
	state: FileStoreState,
	workspaceId: string,
	agentId: string,
): Promise<void> {
	await assertWorkspace(state, workspaceId);
	const rows = await state.readAll("agents");
	if (
		!rows.some((a) => a.workspaceId === workspaceId && a.agentId === agentId)
	) {
		throw new ControlPlaneNotFoundError("agent", agentId);
	}
}

/**
 * Resolve a conversation across any agent in the workspace. Messages
 * are partitioned by (workspace, conversation), not (workspace, agent,
 * conversation), so chat-message append / list / update don't need an
 * agent argument.
 */
export async function assertChat(
	state: FileStoreState,
	workspaceId: string,
	chatId: string,
): Promise<void> {
	await assertWorkspace(state, workspaceId);
	const rows = await state.readAll("conversations");
	const exists = rows.some(
		(c) => c.workspaceId === workspaceId && c.conversationId === chatId,
	);
	if (!exists) {
		throw new ControlPlaneNotFoundError("chat", chatId);
	}
}

/** Refuse to delete a service that any KB still references. */
export async function assertServiceNotReferenced(
	state: FileStoreState,
	workspace: string,
	field: KnowledgeBaseServiceReferenceField,
	serviceId: string,
): Promise<void> {
	const kbs = await state.readAll("knowledge-bases");
	const ref = kbs.find(
		(kb) => kb.workspaceId === workspace && kb[field] === serviceId,
	);
	if (ref) {
		throw serviceReferencedByKnowledgeBase(
			serviceId,
			ref.knowledgeBaseId,
			field,
		);
	}
}

/** Refuse to delete a service that any agent still references. */
export async function assertAgentServiceNotReferenced(
	state: FileStoreState,
	workspace: string,
	field: AgentServiceReferenceField,
	serviceId: string,
): Promise<void> {
	const agents = await state.readAll("agents");
	const ref = agents.find(
		(agent) => agent.workspaceId === workspace && agent[field] === serviceId,
	);
	if (ref) {
		throw serviceReferencedByAgent(serviceId, ref.agentId, field);
	}
}
