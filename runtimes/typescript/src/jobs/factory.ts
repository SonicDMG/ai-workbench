/**
 * Build a {@link JobStore} for the runtime.
 *
 * Defaults mirror the control-plane driver unless explicitly
 * overridden — operators almost always want durable jobs wherever
 * they want durable workspaces, so auto-matching is the right
 * ergonomic default:
 *
 *   controlPlane.driver === "memory"  → {@link MemoryJobStore}
 *   controlPlane.driver === "file"    → {@link FileJobStore} at the
 *                                       same `root` as the control
 *                                       plane (jobs.json alongside
 *                                       workspaces.json, etc.)
 *   controlPlane.driver === "astra"   → {@link AstraJobStore} sharing
 *                                       the already-open tables
 *                                       bundle (adds one table row on
 *                                       top of the existing six).
 *
 * Callers that want a different pairing (e.g. memory control plane +
 * file jobs) pass a store instance directly into {@link createApp}'s
 * `jobs` option.
 */

import type { TablesBundle } from "../astra-client/tables.js";
import type { ControlPlaneConfig } from "../config/schema.js";
import { AstraJobStore } from "./astra-store.js";
import { FileJobStore } from "./file-store.js";
import { MemoryJobStore } from "./memory-store.js";
import type { JobStore } from "./store.js";

export interface BuildJobStoreOptions {
	readonly controlPlane: ControlPlaneConfig;
	/** Required when `controlPlane.driver === "astra"`. The existing
	 * control-plane tables bundle is reused verbatim so we don't open
	 * a second connection. */
	readonly astraTables?: TablesBundle;
}

export async function buildJobStore(
	opts: BuildJobStoreOptions,
): Promise<JobStore> {
	switch (opts.controlPlane.driver) {
		case "memory":
			return new MemoryJobStore();
		case "file": {
			const store = new FileJobStore({ root: opts.controlPlane.root });
			await store.init();
			return store;
		}
		case "astra": {
			if (!opts.astraTables) {
				throw new Error(
					"buildJobStore: astraTables is required when controlPlane.driver is 'astra'",
				);
			}
			return new AstraJobStore(opts.astraTables, {
				pollIntervalMs: opts.controlPlane.jobPollIntervalMs,
			});
		}
	}
}
