/**
 * Builds a {@link ControlPlaneStore} from config.
 *
 * Each driver gets one entrypoint:
 *   memory → fresh Map-of-Maps, optionally seeded.
 *   file   → JSON-on-disk at `root`.
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
import { DEFAULT_SERVICES } from "./default-services.js";
import { FileControlPlaneStore } from "./file/store.js";
import { MemoryControlPlaneStore } from "./memory/store.js";
import type { ControlPlaneStore } from "./store.js";

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

/**
 * Backward-compatible wrapper. Prefer {@link buildControlPlane} when
 * the caller wants the tables bundle too (e.g. for the JobStore
 * factory).
 */
export async function buildControlPlaneStore(
	opts: BuildStoreOptions,
): Promise<ControlPlaneStore> {
	const { store } = await buildControlPlane(opts);
	return store;
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
		await seedDefaultServices(store, ws.uid);
	}
}

/**
 * Populate a workspace with the canonical built-in chunking and
 * embedding services. Idempotent in spirit — duplicate-name collisions
 * surface as the underlying store's own error and are caught here so a
 * second seed pass on a workspace that already has them is a no-op.
 */
async function seedDefaultServices(
	store: MemoryControlPlaneStore,
	workspaceId: string,
): Promise<void> {
	for (const chunk of DEFAULT_SERVICES.chunking) {
		try {
			await store.createChunkingService(workspaceId, chunk);
		} catch {
			// Already present — leave operator's edits alone.
		}
	}
	for (const emb of DEFAULT_SERVICES.embedding) {
		try {
			await store.createEmbeddingService(workspaceId, emb);
		} catch {
			// Already present — leave operator's edits alone.
		}
	}
}

/** Convenience wrapper for {@link buildControlPlaneStore} that takes a
 * full {@link Config}. Keeps {@link ../root.ts} short. */
export async function storeFromConfig(
	config: Config,
	secrets: SecretResolver,
): Promise<ControlPlaneStore> {
	return buildControlPlaneStore({
		controlPlane: config.controlPlane,
		seedWorkspaces: config.seedWorkspaces,
		secrets,
	});
}

/** Same as {@link storeFromConfig} but returns the full
 * {@link BuiltControlPlane} so the caller can hand the astra tables
 * bundle to the JobStore factory. */
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
