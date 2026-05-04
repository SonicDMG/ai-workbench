/**
 * Bounds the number of in-flight `runKbIngestJob` invocations on a
 * single replica.
 *
 * Why: `services/ingest-service.ts` and `root.ts` (orphan resume) both
 * spawn ingest jobs with `void runKbIngestJob(...)` — fire-and-forget.
 * Without bounding, a burst of 1000 register-and-ingest calls turns
 * into 1000 concurrent embedder requests, which slams the upstream
 * provider's quota and starves every other workspace's ingest.
 *
 * Design: a simple counting semaphore with a FIFO waiter queue. When
 * the active count is below capacity, `acquire()` resolves
 * immediately. Otherwise the caller queues. There's no overflow
 * rejection — the job is already persisted in the job store before
 * `runKbIngestJob` is spawned, so a queued worker isn't losing work,
 * just holding a slot until upstream capacity frees up. If the queue
 * grows pathologically, the orphan-sweeper on a healthier replica
 * will eventually re-claim and finish.
 *
 * Stats are exposed via `stats()` for `/readyz` and (later) `/metrics`.
 *
 * Caller contract: every successful `acquire()` MUST be paired with a
 * call to the returned `release()` exactly once. The provided
 * {@link runBounded} helper handles this with a `try/finally` so
 * callers don't have to remember.
 */

export interface IngestSemaphoreStats {
	/** Currently in-flight ingest jobs on this replica. */
	readonly active: number;
	/** Hard cap. */
	readonly capacity: number;
	/** Workers blocked waiting for a slot. */
	readonly queued: number;
}

export class IngestSemaphore {
	private active = 0;
	private readonly waiters: Array<() => void> = [];

	constructor(private readonly capacity: number) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new Error("ingest semaphore capacity must be a positive integer");
		}
	}

	/**
	 * Acquire a slot. Resolves with a release function that the caller
	 * MUST invoke exactly once. Prefer {@link runBounded} which wraps
	 * the lifetime in a `try/finally`.
	 */
	async acquire(): Promise<() => void> {
		if (this.active < this.capacity) {
			this.active += 1;
			return () => this.release();
		}
		return new Promise<() => void>((resolve) => {
			this.waiters.push(() => {
				this.active += 1;
				resolve(() => this.release());
			});
		});
	}

	private release(): void {
		this.active -= 1;
		const next = this.waiters.shift();
		if (next) next();
	}

	stats(): IngestSemaphoreStats {
		return {
			active: this.active,
			capacity: this.capacity,
			queued: this.waiters.length,
		};
	}
}

/**
 * Wrap an async unit of work with semaphore acquire/release. The
 * callback runs exactly once a slot is available; the slot is
 * released even if the callback throws. Returns whatever the
 * callback returned.
 */
export async function runBounded<T>(
	semaphore: IngestSemaphore,
	work: () => Promise<T>,
): Promise<T> {
	const release = await semaphore.acquire();
	try {
		return await work();
	} finally {
		release();
	}
}
