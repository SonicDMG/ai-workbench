/**
 * Resume-callback registry consulted by the {@link ./sweeper.JobOrphanSweeper}.
 *
 * Generalizes job durability from the original ingest-only resume hook
 * to any {@link JobKind}: each async operation that wants its orphans
 * replayed (instead of marked failed on lease expiry) registers a
 * {@link ResumeCallback} under its kind. On reclaiming a stale-leased
 * `running` job the sweeper looks up the kind's callback and replays
 * from the persisted snapshot; kinds with no registered callback fall
 * back to the legacy mark-failed behavior.
 *
 * Mirrors the register-by-kind shape of {@link ./scheduler.JobScheduler}
 * so the two stay recognizable as a pair (run-forward vs. resume).
 */

import type { JobInputSnapshot } from "./types.js";

/**
 * Callback invoked by the sweeper after a successful CAS-claim, when
 * the orphan's {@link JobKind} has a registered resume callback **and**
 * the job carries an {@link JobInputSnapshot}. The runtime wires this
 * to the kind's worker. Must be detached (the sweeper does not await
 * the replay to completion) and must drive the job to a terminal state
 * itself.
 *
 * `snapshot` is the kind-tagged blob persisted at create time; the
 * callback for a given kind knows its concrete shape (for `ingest`,
 * an `IngestInputSnapshot`).
 */
export type ResumeCallback = (args: {
	readonly workspaceId: string;
	readonly jobId: string;
	readonly replicaId: string;
	readonly snapshot: JobInputSnapshot;
}) => void | Promise<void>;

/**
 * `JobKind → ResumeCallback` registry. Construct, `register()` each
 * resumable kind, hand to the sweeper. Lookups for an unregistered
 * kind return `undefined`, which the sweeper treats as "fall back to
 * mark-failed".
 *
 * Keyed on `string` rather than the closed `JobKind` literal so the
 * registry doesn't have to be widened in lockstep with the wire-facing
 * `JobKind` union — a `JobRecord.kind` is always a `string`, and
 * forward-looking kinds can be wired up before they gain a literal.
 */
export class ResumeRegistry {
	private readonly callbacks = new Map<string, ResumeCallback>();

	/**
	 * Register a resume callback for one job kind. Throws on duplicate
	 * registration so a misconfigured runtime fails fast at boot —
	 * same policy as {@link JobScheduler.register}.
	 */
	register(kind: string, callback: ResumeCallback): this {
		if (this.callbacks.has(kind)) {
			throw new Error(
				`ResumeRegistry: resume callback for kind '${kind}' already registered`,
			);
		}
		this.callbacks.set(kind, callback);
		return this;
	}

	/** Look up the resume callback for a kind, or `undefined` if none
	 * is registered. */
	get(kind: string): ResumeCallback | undefined {
		return this.callbacks.get(kind);
	}

	/** Whether any kind has a registered resume callback. The sweeper
	 * uses this to keep the "no hook configured" error message
	 * accurate. */
	get size(): number {
		return this.callbacks.size;
	}
}
