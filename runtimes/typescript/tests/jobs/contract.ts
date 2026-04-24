/**
 * Shared behavioral contract for {@link JobStore}.
 *
 * Every backend (memory, file, astra) runs the same assertions against
 * a factory-produced instance — keeps behavior identical across
 * impls modulo durability, and gives each new backend an immediate
 * wire of what "correct" means.
 */

import { describe, expect, test } from "vitest";
import { ControlPlaneNotFoundError } from "../../src/control-plane/errors.js";
import type { JobStore } from "../../src/jobs/store.js";
import type { JobRecord } from "../../src/jobs/types.js";

const WORKSPACE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

export type JobStoreFactory = () => Promise<{
	readonly store: JobStore;
	readonly cleanup?: () => Promise<void>;
}>;

export function runJobStoreContract(
	label: string,
	factory: JobStoreFactory,
): void {
	describe(`JobStore contract: ${label}`, () => {
		test("create → get round-trip", async () => {
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				expect(job.jobId).toMatch(/^[0-9a-f-]{36}$/);
				expect(job.status).toBe("pending");
				expect(await store.get(WORKSPACE_A, job.jobId)).toEqual(job);
			} finally {
				await cleanup?.();
			}
		});

		test("get returns null for unknown (workspace, jobId)", async () => {
			const { store, cleanup } = await factory();
			try {
				expect(
					await store.get(WORKSPACE_A, "00000000-0000-0000-0000-000000000000"),
				).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("jobs are scoped by workspace", async () => {
			const { store, cleanup } = await factory();
			try {
				const a = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				expect(await store.get(WORKSPACE_B, a.jobId)).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("update throws when the job is missing", async () => {
			const { store, cleanup } = await factory();
			try {
				await expect(
					store.update(WORKSPACE_A, "00000000-0000-0000-0000-000000000000", {
						status: "running",
					}),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("update applies fields + bumps updatedAt", async () => {
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				await new Promise((r) => setTimeout(r, 5));
				const running = await store.update(WORKSPACE_A, job.jobId, {
					status: "running",
					processed: 1,
					total: 4,
				});
				expect(running.status).toBe("running");
				expect(running.processed).toBe(1);
				expect(running.total).toBe(4);
				expect(new Date(running.updatedAt).getTime()).toBeGreaterThanOrEqual(
					new Date(job.updatedAt).getTime(),
				);
				// Terminal success carries a result object. Serialization
				// (astra stringifies + parses) must round-trip cleanly.
				const done = await store.update(WORKSPACE_A, job.jobId, {
					status: "succeeded",
					result: { chunks: 4, source: "demo" },
				});
				expect(done.status).toBe("succeeded");
				expect(done.result).toEqual({ chunks: 4, source: "demo" });
				// Re-read to confirm the backing store persisted the
				// update, not just the in-memory reply.
				expect((await store.get(WORKSPACE_A, job.jobId))?.result).toEqual({
					chunks: 4,
					source: "demo",
				});
			} finally {
				await cleanup?.();
			}
		});

		test("subscribe replays current state and fires on update", async () => {
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				const seen: JobRecord[] = [];
				const unsub = await store.subscribe(WORKSPACE_A, job.jobId, (r) => {
					seen.push(r);
				});
				expect(seen).toHaveLength(1);
				expect(seen[0]?.status).toBe("pending");
				await store.update(WORKSPACE_A, job.jobId, { status: "running" });
				expect(seen.at(-1)?.status).toBe("running");
				unsub();
				await store.update(WORKSPACE_A, job.jobId, { processed: 2 });
				expect(seen).toHaveLength(2);
			} finally {
				await cleanup?.();
			}
		});

		test("unsubscribe is safe to call twice", async () => {
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				const unsub = await store.subscribe(WORKSPACE_A, job.jobId, () => {});
				unsub();
				expect(() => unsub()).not.toThrow();
			} finally {
				await cleanup?.();
			}
		});

		test("a throwing listener does not block other listeners", async () => {
			const { store, cleanup } = await factory();
			try {
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
				await store.update(WORKSPACE_A, job.jobId, { status: "running" });
				expect(good.map((r) => r.status)).toEqual(["pending", "running"]);
			} finally {
				await cleanup?.();
			}
		});
	});
}
