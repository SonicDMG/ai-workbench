/**
 * Dispatches {@link VectorStoreDriver} operations based on the target
 * workspace's `kind`.
 *
 * The runtime holds exactly one registry. Each driver is registered
 * once at startup; individual drivers may cache per-workspace state
 * internally.
 */

import type { WorkspaceRecord } from "../control-plane/types.js";
import {
	DriverUnavailableError,
	type VectorStoreDriver,
} from "./vector-store.js";

export type WorkspaceKind = WorkspaceRecord["kind"];

export class VectorStoreDriverRegistry {
	constructor(
		private readonly drivers: ReadonlyMap<WorkspaceKind, VectorStoreDriver>,
	) {}

	for(workspace: WorkspaceRecord): VectorStoreDriver {
		const d = this.drivers.get(workspace.kind);
		if (!d) throw new DriverUnavailableError(workspace.kind);
		return d;
	}

	has(kind: WorkspaceKind): boolean {
		return this.drivers.has(kind);
	}
}
