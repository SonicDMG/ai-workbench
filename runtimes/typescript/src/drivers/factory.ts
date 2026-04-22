/**
 * Builds the runtime's {@link VectorStoreDriverRegistry} from the
 * resolved {@link SecretResolver}.
 *
 * For Phase 1b we always register `mock` and `astra`. `hcd` and
 * `openrag` workspaces surface as `DriverUnavailableError` when
 * their data plane is touched.
 */

import type { SecretResolver } from "../secrets/provider.js";
import { AstraVectorStoreDriver } from "./astra/store.js";
import { MockVectorStoreDriver } from "./mock/store.js";
import { VectorStoreDriverRegistry, type WorkspaceKind } from "./registry.js";
import type { VectorStoreDriver } from "./vector-store.js";

export interface BuildRegistryOptions {
	readonly secrets: SecretResolver;
	/** Overrides for individual drivers — tests inject fakes here. */
	readonly overrides?: Partial<Record<WorkspaceKind, VectorStoreDriver>>;
}

export function buildVectorStoreDriverRegistry(
	opts: BuildRegistryOptions,
): VectorStoreDriverRegistry {
	const overrides = opts.overrides ?? {};
	const drivers = new Map<WorkspaceKind, VectorStoreDriver>();
	drivers.set("mock", overrides.mock ?? new MockVectorStoreDriver());
	drivers.set(
		"astra",
		overrides.astra ?? new AstraVectorStoreDriver({ secrets: opts.secrets }),
	);
	if (overrides.hcd) drivers.set("hcd", overrides.hcd);
	if (overrides.openrag) drivers.set("openrag", overrides.openrag);
	return new VectorStoreDriverRegistry(drivers);
}
