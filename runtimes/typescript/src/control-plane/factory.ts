/**
 * Builds a {@link ControlPlaneStore} from config.
 *
 * Each driver gets one entrypoint:
 *   memory → fresh Map-of-Maps, optionally seeded.
 *   file   → JSON-on-disk at `root`.
 *   sqlite → SQLite (WAL, row-level writes) at `path`; the durable
 *            single-node choice for chat-heavy deployments.
 *   astra  → Data API Tables via `@datastax/astra-db-ts`, token
 *            resolved through the provided {@link SecretResolver}.
 *
 * Called once at startup by {@link ../root.ts}. The returned store
 * satisfies the same {@link ControlPlaneStore} contract regardless of
 * driver.
 */

import { openAstraClient } from "../astra-client/client.js";
import type { TablesBundle } from "../astra-client/tables.js";
import type {
	Config,
	ControlPlaneConfig,
	SeedWorkspace,
} from "../config/schema.js";
import type { SecretResolver } from "../secrets/provider.js";
import { AstraControlPlaneStore } from "./astra/store.js";
import {
	DEFAULT_SERVICES,
	MOCK_WORKSPACE_SEED_SERVICES,
} from "./default-services.js";
import { FileControlPlaneStore } from "./file/store.js";
import { MemoryControlPlaneStore } from "./memory/store.js";
import { SqliteControlPlaneStore } from "./sqlite/store.js";
import type { ControlPlaneStore } from "./store.js";
import type { WorkspaceKind } from "./types.js";

export interface BuildStoreOptions {
	readonly controlPlane: ControlPlaneConfig;
	readonly seedWorkspaces: readonly SeedWorkspace[];
	readonly secrets: SecretResolver;
}

/**
 * Bundle returned by {@link buildControlPlane} — the store plus any
 * auxiliary resources a sibling factory (today: the JobStore) might
 * want to reuse rather than re-open. For memory/file backends
 * `astraTables` is `undefined`; only the astra branch populates it.
 */
export interface BuiltControlPlane {
	readonly store: ControlPlaneStore;
	readonly astraTables: TablesBundle | undefined;
}

export async function buildControlPlane(
	opts: BuildStoreOptions,
): Promise<BuiltControlPlane> {
	switch (opts.controlPlane.driver) {
		case "memory": {
			const store = new MemoryControlPlaneStore();
			await seedMemoryStore(store, opts.seedWorkspaces);
			return { store, astraTables: undefined };
		}
		case "file": {
			const store = new FileControlPlaneStore({ root: opts.controlPlane.root });
			await store.init?.();
			return { store, astraTables: undefined };
		}
		case "sqlite": {
			const store = new SqliteControlPlaneStore({
				path: opts.controlPlane.path,
			});
			await store.init?.();
			return { store, astraTables: undefined };
		}
		case "astra": {
			const token = await opts.secrets.resolve(opts.controlPlane.tokenRef);
			const tables = await openAstraClient({
				endpoint: opts.controlPlane.endpoint,
				token,
				keyspace: opts.controlPlane.keyspace,
			});
			return {
				store: new AstraControlPlaneStore(tables),
				astraTables: tables,
			};
		}
	}
}

async function seedMemoryStore(
	store: MemoryControlPlaneStore,
	seeds: readonly SeedWorkspace[],
): Promise<void> {
	for (const seed of seeds) {
		const ws = await store.createWorkspace({
			uid: seed.uid,
			name: seed.name,
			url: seed.url ?? null,
			kind: seed.kind,
			credentials: seed.credentials ?? {},
			keyspace: seed.keyspace ?? null,
		});
		await seedDefaultServices(store, ws.uid, ws.kind);
	}
}

/**
 * Populate a workspace with the canonical built-in chunking and
 * embedding services. Mock workspaces additionally get the
 * credential-free mock embedder — the only provider their vector
 * driver accepts for text upsert — so a seeded mock workspace can
 * ingest without any provider auth (#363). Idempotent in spirit —
 * duplicate-name collisions surface as the underlying store's own
 * error and are caught here so a second seed pass on a workspace that
 * already has them is a no-op.
 */
async function seedDefaultServices(
	store: MemoryControlPlaneStore,
	workspaceId: string,
	kind: WorkspaceKind,
): Promise<void> {
	for (const chunk of DEFAULT_SERVICES.chunking) {
		try {
			await store.createChunkingService(workspaceId, chunk);
		} catch {
			// Already present — leave operator's edits alone.
		}
	}
	const embedding =
		kind === "mock"
			? [
					...MOCK_WORKSPACE_SEED_SERVICES.embedding,
					...DEFAULT_SERVICES.embedding,
				]
			: DEFAULT_SERVICES.embedding;
	for (const emb of embedding) {
		try {
			await store.createEmbeddingService(workspaceId, emb);
		} catch {
			// Already present — leave operator's edits alone.
		}
	}
}

/** Convenience wrapper for {@link buildControlPlane} that takes a
 * full {@link Config}. Keeps {@link ../root.ts} short and lets the
 * caller pass the resulting astra tables bundle to the JobStore
 * factory. */
export async function controlPlaneFromConfig(
	config: Config,
	secrets: SecretResolver,
): Promise<BuiltControlPlane> {
	return buildControlPlane({
		controlPlane: config.controlPlane,
		seedWorkspaces: config.seedWorkspaces,
		secrets,
	});
}
