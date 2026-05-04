/**
 * Behavioural tests for the ingest concurrency semaphore.
 */

import { describe, expect, test } from "vitest";
import {
	IngestSemaphore,
	runBounded,
} from "../../src/jobs/ingest-semaphore.js";

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (v: T) => void;
}
function deferred<T>(): Deferred<T> {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("IngestSemaphore", () => {
	test("rejects bad capacity at construction", () => {
		expect(() => new IngestSemaphore(0)).toThrow();
		expect(() => new IngestSemaphore(-1)).toThrow();
		expect(() => new IngestSemaphore(1.5)).toThrow();
	});

	test("allows up to `capacity` concurrent acquires without blocking", async () => {
		const sem = new IngestSemaphore(3);
		const r1 = await sem.acquire();
		const r2 = await sem.acquire();
		const r3 = await sem.acquire();
		expect(sem.stats()).toMatchObject({ active: 3, capacity: 3, queued: 0 });
		r1();
		r2();
		r3();
		expect(sem.stats().active).toBe(0);
	});

	test("the (capacity+1)-th acquire blocks until a slot frees", async () => {
		const sem = new IngestSemaphore(2);
		const r1 = await sem.acquire();
		const r2 = await sem.acquire();

		let resolved = false;
		const pending = sem.acquire().then((release) => {
			resolved = true;
			return release;
		});
		// Tick the event loop a couple of times to confirm pending is
		// still pending — not just race-y unresolved.
		await new Promise((r) => setImmediate(r));
		await new Promise((r) => setImmediate(r));
		expect(resolved).toBe(false);
		expect(sem.stats().queued).toBe(1);

		r1();
		const r3 = await pending;
		expect(resolved).toBe(true);
		expect(sem.stats()).toMatchObject({ active: 2, queued: 0 });
		r2();
		r3();
	});

	test("waiters are released in FIFO order", async () => {
		const sem = new IngestSemaphore(1);
		const r1 = await sem.acquire();

		const order: number[] = [];
		const w1 = sem.acquire().then((rel) => {
			order.push(1);
			rel();
		});
		const w2 = sem.acquire().then((rel) => {
			order.push(2);
			rel();
		});
		const w3 = sem.acquire().then((rel) => {
			order.push(3);
			rel();
		});

		r1();
		await Promise.all([w1, w2, w3]);
		expect(order).toEqual([1, 2, 3]);
	});

	test("runBounded releases the slot even when the work throws", async () => {
		const sem = new IngestSemaphore(1);
		await expect(
			runBounded(sem, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(sem.stats().active).toBe(0);

		// Slot should be reusable.
		const result = await runBounded(sem, async () => 42);
		expect(result).toBe(42);
	});

	test("real concurrency cap: with capacity=2, peak active never exceeds 2", async () => {
		const sem = new IngestSemaphore(2);
		const gates = [
			deferred<void>(),
			deferred<void>(),
			deferred<void>(),
			deferred<void>(),
		];
		let peak = 0;
		const tasks = gates.map((g, i) =>
			runBounded(sem, async () => {
				peak = Math.max(peak, sem.stats().active);
				await g.promise;
				return i;
			}),
		);
		// Let two tasks claim slots; the others must queue.
		await new Promise((r) => setImmediate(r));
		expect(sem.stats()).toMatchObject({ active: 2, queued: 2 });

		// Drain in order.
		for (const g of gates) g.resolve();
		await Promise.all(tasks);
		expect(peak).toBeLessThanOrEqual(2);
		expect(sem.stats()).toMatchObject({ active: 0, queued: 0 });
	});
});
