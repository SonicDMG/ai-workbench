import { describe, expect, test } from "vitest";
import {
	AstraJobStore,
	type PollCallback,
	type PollHandle,
	type PollScheduler,
} from "../../src/jobs/astra-store.js";
import type { JobRecord } from "../../src/jobs/types.js";
import { createFakeTablesBundle } from "../control-plane/astra-fake.js";
import { runJobStoreContract } from "./contract.js";

const WORKSPACE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

runJobStoreContract("astra (fake tables)", async () => ({
	store: new AstraJobStore(createFakeTablesBundle()),
}));

describe("AstraJobStore — serialization round-trip", () => {
	test("nested result object survives the text-column round-trip", async () => {
		const store = new AstraJobStore(createFakeTablesBundle());
		const job = await store.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		const complex = {
			chunks: 3,
			nested: { a: 1, b: ["two", 3, { c: true }] },
			nullish: null,
		};
		await store.update(WORKSPACE_A, job.jobId, {
			status: "succeeded",
			result: complex,
		});
		const fetched = await store.get(WORKSPACE_A, job.jobId);
		expect(fetched?.result).toEqual(complex);
	});

	test("null result → null after round-trip (not the string 'null')", async () => {
		const store = new AstraJobStore(createFakeTablesBundle());
		const job = await store.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		await store.update(WORKSPACE_A, job.jobId, {
			status: "failed",
			errorMessage: "boom",
		});
		const fetched = await store.get(WORKSPACE_A, job.jobId);
		expect(fetched?.result).toBeNull();
		expect(fetched?.errorMessage).toBe("boom");
	});
});

/**
 * Manual scheduler — `start()` records the callback, `tick()` invokes
 * every registered callback and awaits any returned promise so test
 * flow stays synchronous. No real timers, so tests don't have to
 * sleep.
 */
class ManualScheduler implements PollScheduler {
	private readonly callbacks = new Set<PollCallback>();
	start(callback: PollCallback): PollHandle {
		this.callbacks.add(callback);
		return {
			stop: () => {
				this.callbacks.delete(callback);
			},
		};
	}
	async tick(): Promise<void> {
		for (const cb of this.callbacks) await cb();
	}
	get callbackCount(): number {
		return this.callbacks.size;
	}
}

// `applyUpdate` derives `updated_at` from `nowIso()` (ms resolution).
// In a real workload writes are spaced out by chunking / network /
// embedding latency, so successive ms-tick collisions are very rare.
// In tests where we hammer create + update in microseconds, we have
// to insert a real delay or two writes can land at the same ms and
// the poller (correctly) treats them as the same state.
async function tickPastMs(): Promise<void> {
	await new Promise((r) => setTimeout(r, 2));
}

describe("AstraJobStore — cross-replica subscription polling", () => {
	test("a subscriber on one replica sees an update made on another after a poll tick", async () => {
		// Same backing tables == same Astra cluster from two replicas.
		const tables = createFakeTablesBundle();
		const schedulerA = new ManualScheduler();
		const schedulerB = new ManualScheduler();
		const replicaA = new AstraJobStore(tables, { scheduler: schedulerA });
		const replicaB = new AstraJobStore(tables, { scheduler: schedulerB });

		// Replica A spawns the job. (In practice, the spawner and the
		// SSE subscriber would be co-located; we simulate the
		// alternative — subscribe on A, write on B — to prove the
		// poller closes the gap.)
		const job = await replicaA.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});

		const seenOnA: JobRecord[] = [];
		const unsub = await replicaA.subscribe(WORKSPACE_A, job.jobId, (rec) => {
			seenOnA.push(rec);
		});
		// Initial replay fired the listener once with the pending state.
		expect(seenOnA).toHaveLength(1);
		expect(seenOnA[0]?.status).toBe("pending");

		// Space the next write past the create's millisecond so
		// `updated_at` actually advances.
		await tickPastMs();

		// Replica B writes — A's local fan-out doesn't fire.
		await replicaB.update(WORKSPACE_A, job.jobId, { status: "running" });
		expect(seenOnA).toHaveLength(1);

		// One tick on A's scheduler picks the change up.
		await schedulerA.tick();
		expect(seenOnA).toHaveLength(2);
		expect(seenOnA[1]?.status).toBe("running");

		// A subsequent tick with no change is a no-op.
		await schedulerA.tick();
		expect(seenOnA).toHaveLength(2);

		// Last unsubscribe stops A's poller.
		unsub();
		expect(schedulerA.callbackCount).toBe(0);
	});

	test("same-replica updates fire immediately AND don't re-fire on the next tick", async () => {
		const tables = createFakeTablesBundle();
		const scheduler = new ManualScheduler();
		const store = new AstraJobStore(tables, { scheduler });

		const job = await store.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		const seen: JobRecord[] = [];
		await store.subscribe(WORKSPACE_A, job.jobId, (rec) => {
			seen.push(rec);
		});
		// initial replay
		expect(seen).toHaveLength(1);

		// Same-replica update fires synchronously.
		await tickPastMs();
		await store.update(WORKSPACE_A, job.jobId, { status: "running" });
		expect(seen).toHaveLength(2);
		expect(seen[1]?.status).toBe("running");

		// The poll tick that follows must not double-fire.
		await scheduler.tick();
		expect(seen).toHaveLength(2);
	});

	test("the poller starts on first subscribe and stops when the last subscriber leaves", async () => {
		const tables = createFakeTablesBundle();
		const scheduler = new ManualScheduler();
		const store = new AstraJobStore(tables, { scheduler });
		const job = await store.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});

		expect(scheduler.callbackCount).toBe(0);

		const unsubA = await store.subscribe(WORKSPACE_A, job.jobId, () => {});
		expect(scheduler.callbackCount).toBe(1);

		// Second subscriber on the same job reuses the timer.
		const unsubB = await store.subscribe(WORKSPACE_A, job.jobId, () => {});
		expect(scheduler.callbackCount).toBe(1);

		unsubA();
		expect(scheduler.callbackCount).toBe(1); // B still subscribed

		unsubB();
		expect(scheduler.callbackCount).toBe(0);
	});

	test("subscribing to a non-existent job is fine; the listener fires once the record materializes", async () => {
		// Replicates the async-ingest race: SSE subscriber may connect
		// before the worker creates the job row. The subscription
		// stays armed until the poller catches the first write.
		const tables = createFakeTablesBundle();
		const schedulerA = new ManualScheduler();
		const replicaA = new AstraJobStore(tables, { scheduler: schedulerA });
		const replicaB = new AstraJobStore(tables);

		const seen: JobRecord[] = [];
		await replicaA.subscribe(
			WORKSPACE_A,
			"00000000-0000-4000-8000-000000000999",
			(rec) => {
				seen.push(rec);
			},
		);
		// No record yet, no fire.
		expect(seen).toHaveLength(0);

		// Worker on replica B creates the job.
		await replicaB.create({
			workspace: WORKSPACE_A,
			jobId: "00000000-0000-4000-8000-000000000999",
			kind: "ingest",
		});

		// Tick: replica A picks it up. (No need to space the create
		// past a ms here — the entry's `lastSeen` was null since the
		// record didn't exist, so any updated_at fires.)
		await schedulerA.tick();
		expect(seen).toHaveLength(1);
		expect(seen[0]?.status).toBe("pending");
	});

	test("stop() halts the poller even with active subscribers (graceful shutdown path)", async () => {
		const tables = createFakeTablesBundle();
		const scheduler = new ManualScheduler();
		const store = new AstraJobStore(tables, { scheduler });
		const job = await store.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		await store.subscribe(WORKSPACE_A, job.jobId, () => {});
		expect(scheduler.callbackCount).toBe(1);

		store.stop();
		expect(scheduler.callbackCount).toBe(0);
	});
});
