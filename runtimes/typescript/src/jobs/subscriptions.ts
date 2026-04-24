/**
 * In-process subscriber registry for the {@link JobStore}.
 *
 * Every shipped backend (memory, file, astra) runs in a single
 * process; `subscribe()` callers are always in the same process as
 * the `update()` caller. So the pub/sub layer is purely in-memory —
 * backends hand it the `JobListener` set, call `fire()` after a
 * successful update, and clean-up is the same everywhere.
 *
 * Cross-process pub/sub (Redis, etc.) would sit **behind** the
 * astra/file backends by fanning out the `fire()` step. The seam is
 * stable even if the transport changes.
 */

import type { JobListener, Unsubscribe } from "./store.js";
import type { JobRecord } from "./types.js";

export class JobSubscriptions {
	private readonly listeners = new Map<string, Set<JobListener>>();

	/** Register a listener. Returns the unsubscribe handle. Safe to
	 * call the handle twice — subsequent calls are no-ops. */
	add(workspace: string, jobId: string, listener: JobListener): Unsubscribe {
		const k = key(workspace, jobId);
		let set = this.listeners.get(k);
		if (!set) {
			set = new Set();
			this.listeners.set(k, set);
		}
		set.add(listener);
		return () => {
			set?.delete(listener);
		};
	}

	/** Invoke every listener for `(workspace, jobId)` with the current
	 * record. Listener exceptions are swallowed so one bad subscriber
	 * can't block the rest. */
	fire(workspace: string, jobId: string, record: JobRecord): void {
		const set = this.listeners.get(key(workspace, jobId));
		if (!set) return;
		for (const listener of set) {
			try {
				listener(record);
			} catch {
				// swallow — listener owns its own errors
			}
		}
	}
}

function key(workspace: string, jobId: string): string {
	return `${workspace}:${jobId}`;
}
