import { randomUUID } from "node:crypto";

/**
 * Build a stable, greppable replica id for the lifetime of one app
 * instance. Format: `<host>-<rand8>` where `host` is the env's
 * `HOSTNAME` (set by Kubernetes from the pod name) or the literal
 * `wb` when unset, and `rand8` is the first 8 hex chars of a fresh
 * UUID. Tests typically pass an explicit `replicaId` and skip this
 * entirely.
 */
export function generateReplicaId(): string {
	const host = process.env.HOSTNAME?.trim() || "wb";
	const rand = randomUUID().replace(/-/g, "").slice(0, 8);
	return `${host}-${rand}`;
}
