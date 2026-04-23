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
import type {
	Config,
	ControlPlaneConfig,
	SeedWorkspace,
} from "../config/schema.js";
import type { SecretResolver } from "../secrets/provider.js";
import { AstraControlPlaneStore } from "./astra/store.js";
import { FileControlPlaneStore } from "./file/store.js";
import { MemoryControlPlaneStore } from "./memory/store.js";
import type { ControlPlaneStore } from "./store.js";

export interface BuildStoreOptions {
	readonly controlPlane: ControlPlaneConfig;
	readonly seedWorkspaces: readonly SeedWorkspace[];
	readonly secrets: SecretResolver;
}

export async function buildControlPlaneStore(
	opts: BuildStoreOptions,
): Promise<ControlPlaneStore> {
	switch (opts.controlPlane.driver) {
		case "memory": {
			const store = new MemoryControlPlaneStore();
			await seedMemoryStore(store, opts.seedWorkspaces);
			return store;
		}
		case "file": {
			const store = new FileControlPlaneStore({ root: opts.controlPlane.root });
			await store.init?.();
			return store;
		}
		case "astra": {
			const token = await opts.secrets.resolve(opts.controlPlane.tokenRef);
			const tables = await openAstraClient({
				endpoint: opts.controlPlane.endpoint,
				token,
				keyspace: opts.controlPlane.keyspace,
			});
			return new AstraControlPlaneStore(tables);
		}
	}
}

async function seedMemoryStore(
	store: MemoryControlPlaneStore,
	seeds: readonly SeedWorkspace[],
): Promise<void> {
	for (const seed of seeds) {
		await store.createWorkspace({
			uid: seed.uid,
			name: seed.name,
			endpoint: seed.endpoint ?? null,
			kind: seed.kind,
			credentialsRef: seed.credentialsRef ?? {},
			keyspace: seed.keyspace ?? null,
		});
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
