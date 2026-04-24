import { describe, expect, test } from "vitest";
import { ControlPlaneNotFoundError } from "../../src/control-plane/errors.js";
import { MemoryJobStore } from "../../src/jobs/memory-store.js";
import type { JobRecord } from "../../src/jobs/types.js";

const WORKSPACE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("MemoryJobStore", () => {
	test("create → get round-trip", async () => {
		const store = new MemoryJobStore();
		const job = await store.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		expect(job.jobId).toMatch(/^[0-9a-f-]{36}$/);
		expect(job.status).toBe("pending");
		expect(await store.get(WORKSPACE_A, job.jobId)).toEqual(job);
	});

	test("update throws when the job is missing", async () => {
		const store = new MemoryJobStore();
		await expect(
			store.update(WORKSPACE_A, "missing", { status: "running" }),
		).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
	});

	test("update notifies subscribers in order and bumps updatedAt", async () => {
		const store = new MemoryJobStore();
		const job = await store.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		const seen: JobRecord[] = [];
		const unsub = await store.subscribe(WORKSPACE_A, job.jobId, (r) => {
			seen.push(r);
		});
		// Initial replay.
		expect(seen).toHaveLength(1);
		expect(seen[0]?.status).toBe("pending");

		await new Promise((r) => setTimeout(r, 5));
		const running = await store.update(WORKSPACE_A, job.jobId, {
			status: "running",
			processed: 1,
			total: 4,
		});
		expect(seen).toHaveLength(2);
		expect(seen[1]?.status).toBe("running");
		expect(seen[1]?.processed).toBe(1);
		expect(new Date(running.updatedAt).getTime()).toBeGreaterThanOrEqual(
			new Date(job.updatedAt).getTime(),
		);

		await store.update(WORKSPACE_A, job.jobId, {
			status: "succeeded",
			result: { chunks: 4 },
		});
		expect(seen).toHaveLength(3);
		expect(seen[2]?.status).toBe("succeeded");
		expect(seen[2]?.result).toEqual({ chunks: 4 });

		unsub();
		await store.update(WORKSPACE_A, job.jobId, { processed: 4 });
		// No new notifications after unsubscribe.
		expect(seen).toHaveLength(3);
	});

	test("unsubscribe is safe to call twice", async () => {
		const store = new MemoryJobStore();
		const job = await store.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		const unsub = await store.subscribe(WORKSPACE_A, job.jobId, () => {});
		unsub();
		expect(() => unsub()).not.toThrow();
	});

	test("a throwing listener does not block other listeners", async () => {
		const store = new MemoryJobStore();
		const job = await store.create({
			workspace: WORKSPACE_A,
			kind: "ingest",
		});
		const good: JobRecord[] = [];
		await store.subscribe(WORKSPACE_A, job.jobId, () => {
			throw new Error("boom");
		});
		await store.subscribe(WORKSPACE_A, job.jobId, (r) => {
			good.push(r);
		});
		const updated = await store.update(WORKSPACE_A, job.jobId, {
			status: "running",
		});
		// Good listener received both the initial replay and the update.
		expect(good.map((r) => r.status)).toEqual(["pending", "running"]);
		expect(updated.status).toBe("running");
	});
});
