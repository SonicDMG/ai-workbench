/**
 * Shared behavioral contract for {@link JobStore}.
 *
 * Every backend (memory, file, astra, sqlite) runs the same assertions
 * against a factory-produced instance — keeps behavior identical across
 * impls modulo durability, and gives each new backend an immediate
 * wire of what "correct" means.
 *
 * Includes an end-to-end durability slice (D2): a real
 * {@link JobOrphanSweeper} backed by the store reclaims a stale-leased
 * job of a non-ingest kind and replays it through a registered
 * {@link ResumeRegistry} callback — proving resume generalizes past
 * ingest against every backend's `findStaleRunning` + `claim` +
 * snapshot round-trip.
 */

import { describe, expect, test, vi } from "vitest";
import { ControlPlaneNotFoundError } from "../../src/control-plane/errors.js";
import { ResumeRegistry } from "../../src/jobs/resume-registry.js";
import type { JobStore } from "../../src/jobs/store.js";
import {
	JobOrphanSweeper,
	type SweepCallback,
	type SweepHandle,
	type SweepScheduler,
} from "../../src/jobs/sweeper.js";
import type { JobKind, JobRecord } from "../../src/jobs/types.js";

const WORKSPACE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** A job kind with no wire schema and no producer — stands in for a
 * future resumable kind (reindex, bulk export) to prove resume isn't
 * ingest-specific. Cast because `JobKind` is a closed literal union;
 * the store layer treats `kind` as an opaque string. */
const SECOND_KIND = "reindex" as JobKind;

/** Manual scheduler so the sweeper test drives `tick()` synchronously
 * instead of waiting on a real timer. */
class ManualSweepScheduler implements SweepScheduler {
	private cb: SweepCallback | null = null;
	start(callback: SweepCallback): SweepHandle {
		this.cb = callback;
		return {
			stop: () => {
				this.cb = null;
			},
		};
	}
	async tick(): Promise<void> {
		if (this.cb) await this.cb();
	}
}

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

		test("freshly created jobs are unleased", async () => {
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				expect(job.leasedBy).toBeNull();
				expect(job.leasedAt).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("update can stamp and clear lease fields", async () => {
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				const heartbeat = "2026-04-25T17:00:00.000Z";
				const claimed = await store.update(WORKSPACE_A, job.jobId, {
					status: "running",
					leasedBy: "wb-replica-a",
					leasedAt: heartbeat,
				});
				expect(claimed.leasedBy).toBe("wb-replica-a");
				expect(claimed.leasedAt).toBe(heartbeat);

				const released = await store.update(WORKSPACE_A, job.jobId, {
					status: "succeeded",
					leasedBy: null,
					leasedAt: null,
				});
				expect(released.leasedBy).toBeNull();
				expect(released.leasedAt).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("partial updates leave lease fields untouched", async () => {
			// Heartbeat-only updates (just bumping leasedAt) shouldn't
			// nuke leasedBy, and progress-only updates shouldn't nuke
			// either lease field. Same goes for unrelated fields.
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				await store.update(WORKSPACE_A, job.jobId, {
					status: "running",
					leasedBy: "wb-replica-a",
					leasedAt: "2026-04-25T17:00:00.000Z",
				});
				const after = await store.update(WORKSPACE_A, job.jobId, {
					processed: 3,
				});
				expect(after.leasedBy).toBe("wb-replica-a");
				expect(after.leasedAt).toBe("2026-04-25T17:00:00.000Z");
				expect(after.processed).toBe(3);
			} finally {
				await cleanup?.();
			}
		});

		test("create persists inputSnapshot when supplied", async () => {
			// Resumable async routes stamp a kind-tagged snapshot on the
			// job so the orphan sweeper can replay it on reclaim.
			// Round-tripping through every backend matters because the
			// sweeper reads from whichever store the runtime is using.
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
					inputSnapshot: {
						text: "alpha bravo charlie",
						metadata: { source: "test.md" },
						chunker: { maxChars: 80 },
					},
				});
				expect(job.inputSnapshot).toEqual({
					text: "alpha bravo charlie",
					metadata: { source: "test.md" },
					chunker: { maxChars: 80 },
				});
				const fetched = await store.get(WORKSPACE_A, job.jobId);
				expect(fetched?.inputSnapshot).toEqual(job.inputSnapshot);
			} finally {
				await cleanup?.();
			}
		});

		test("create accepts the deprecated ingestInput alias (back-compat)", async () => {
			// The ingest service still passes `ingestInput`; it must land
			// in the kind-agnostic `inputSnapshot` field so the sweeper
			// reads it back uniformly.
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
					ingestInput: {
						text: "legacy field",
						metadata: { source: "old.md" },
					},
				});
				expect(job.inputSnapshot).toEqual({
					text: "legacy field",
					metadata: { source: "old.md" },
				});
				const fetched = await store.get(WORKSPACE_A, job.jobId);
				expect(fetched?.inputSnapshot).toEqual(job.inputSnapshot);
			} finally {
				await cleanup?.();
			}
		});

		test("inputSnapshot defaults to null when omitted at create", async () => {
			// Sync ingests and non-resumable jobs allocate without a
			// snapshot — null is the explicit "nothing to resume" signal
			// the sweeper checks.
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				expect(job.inputSnapshot).toBeNull();
				const fetched = await store.get(WORKSPACE_A, job.jobId);
				expect(fetched?.inputSnapshot).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("inputSnapshot survives unrelated updates", async () => {
			// Heartbeats and progress patches must not clobber the
			// snapshot — the sweeper expects to read it back unchanged
			// any time after create.
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
					inputSnapshot: { text: "snapshot stays put" },
				});
				await store.update(WORKSPACE_A, job.jobId, { status: "running" });
				const after = await store.update(WORKSPACE_A, job.jobId, {
					processed: 5,
				});
				expect(after.inputSnapshot).toEqual({ text: "snapshot stays put" });
			} finally {
				await cleanup?.();
			}
		});

		test("findStaleRunning returns running jobs whose lease is older than the cutoff", async () => {
			const { store, cleanup } = await factory();
			try {
				const stale = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				await store.update(WORKSPACE_A, stale.jobId, {
					status: "running",
					leasedBy: "wb-replica-old",
					leasedAt: "2020-01-01T00:00:00.000Z",
				});
				const fresh = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				await store.update(WORKSPACE_A, fresh.jobId, {
					status: "running",
					leasedBy: "wb-replica-new",
					leasedAt: "2099-01-01T00:00:00.000Z",
				});
				// Pending jobs shouldn't appear regardless of leasedAt.
				await store.create({ workspace: WORKSPACE_A, kind: "ingest" });

				const result = await store.findStaleRunning("2026-04-25T00:00:00.000Z");
				const ids = result.map((r) => r.jobId);
				expect(ids).toContain(stale.jobId);
				expect(ids).not.toContain(fresh.jobId);
			} finally {
				await cleanup?.();
			}
		});

		test("findStaleRunning surfaces null-leased running rows (pre-lease-columns)", async () => {
			// Records persisted before the lease columns came in carry
			// `leasedAt: null`. The sweeper must consider those orphaned
			// — otherwise post-deploy they'd sit in `running` forever.
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				await store.update(WORKSPACE_A, job.jobId, { status: "running" });
				const result = await store.findStaleRunning("2026-04-25T00:00:00.000Z");
				expect(result.map((r) => r.jobId)).toContain(job.jobId);
			} finally {
				await cleanup?.();
			}
		});

		test("claim succeeds when expectedHolder matches and assigns leasedBy/leasedAt", async () => {
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				await store.update(WORKSPACE_A, job.jobId, {
					status: "running",
					leasedBy: "wb-replica-a",
					leasedAt: "2020-01-01T00:00:00.000Z",
				});
				const claimed = await store.claim(
					WORKSPACE_A,
					job.jobId,
					"wb-replica-a",
					"wb-replica-b",
				);
				expect(claimed?.leasedBy).toBe("wb-replica-b");
				expect(claimed?.leasedAt).toBeTruthy();
			} finally {
				await cleanup?.();
			}
		});

		test("claim returns null on lost CAS race (expectedHolder mismatch)", async () => {
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				await store.update(WORKSPACE_A, job.jobId, {
					status: "running",
					leasedBy: "wb-replica-a",
					leasedAt: "2020-01-01T00:00:00.000Z",
				});
				// Replica B and C both observe holder = "a", but B
				// claims first (a → b). C still passes "a" as the
				// expected holder and loses the race.
				const winner = await store.claim(
					WORKSPACE_A,
					job.jobId,
					"wb-replica-a",
					"wb-replica-b",
				);
				const loser = await store.claim(
					WORKSPACE_A,
					job.jobId,
					"wb-replica-a",
					"wb-replica-c",
				);
				expect(winner?.leasedBy).toBe("wb-replica-b");
				expect(loser).toBeNull();
				const after = await store.get(WORKSPACE_A, job.jobId);
				expect(after?.leasedBy).toBe("wb-replica-b");
			} finally {
				await cleanup?.();
			}
		});

		test("claim with expectedHolder=null grabs an unleased record", async () => {
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: "ingest",
				});
				await store.update(WORKSPACE_A, job.jobId, { status: "running" });
				// Currently leasedBy is null; claim with null and become the
				// holder.
				const claimed = await store.claim(
					WORKSPACE_A,
					job.jobId,
					null,
					"wb-replica-x",
				);
				expect(claimed?.leasedBy).toBe("wb-replica-x");
			} finally {
				await cleanup?.();
			}
		});

		test("claim returns null when the job is missing", async () => {
			const { store, cleanup } = await factory();
			try {
				expect(
					await store.claim(
						WORKSPACE_A,
						"00000000-0000-0000-0000-000000000000",
						null,
						"wb-replica-x",
					),
				).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("sweeper resumes a stale non-ingest job via the resume registry", async () => {
			// D2 end-to-end: a real JobOrphanSweeper backed by this store
			// reclaims a stale-leased `running` job of a *second* kind and
			// replays it through the registered resume callback instead of
			// marking it failed. Exercises this backend's findStaleRunning
			// + claim + snapshot round-trip — proving resume isn't
			// ingest-specific.
			const { store, cleanup } = await factory();
			try {
				const snapshot = { target: "kb-42", reason: "schema-change" };
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: SECOND_KIND,
					inputSnapshot: snapshot,
				});
				await store.update(WORKSPACE_A, job.jobId, {
					status: "running",
					leasedBy: "wb-replica-old",
					leasedAt: "2020-01-01T00:00:00.000Z",
				});

				const resume = vi.fn(async () => undefined);
				const resumes = new ResumeRegistry().register(SECOND_KIND, resume);
				const scheduler = new ManualSweepScheduler();
				const sweeper = new JobOrphanSweeper({
					jobs: store,
					replicaId: "wb-replica-resumer",
					graceMs: 1_000,
					scheduler,
					resumes,
				});
				sweeper.start();
				await scheduler.tick();
				sweeper.stop();

				// The registered callback ran with the persisted snapshot,
				// and the sweeper did NOT mark the job failed (the resume
				// callback owns driving it to terminal).
				expect(resume).toHaveBeenCalledTimes(1);
				expect(resume).toHaveBeenCalledWith({
					workspaceId: WORKSPACE_A,
					jobId: job.jobId,
					replicaId: "wb-replica-resumer",
					snapshot,
				});
				const after = await store.get(WORKSPACE_A, job.jobId);
				expect(after?.status).toBe("running");
				expect(after?.leasedBy).toBe("wb-replica-resumer");
			} finally {
				await cleanup?.();
			}
		});

		test("sweeper marks a stale job failed when its kind has no resume callback", async () => {
			// The fallback half of the registry contract: a kind with no
			// registered resume callback (even with a snapshot present)
			// flows through mark-failed so SSE clients see a terminal
			// state. Runs against every backend.
			const { store, cleanup } = await factory();
			try {
				const job = await store.create({
					workspace: WORKSPACE_A,
					kind: SECOND_KIND,
					inputSnapshot: { target: "kb-7" },
				});
				await store.update(WORKSPACE_A, job.jobId, {
					status: "running",
					leasedBy: "wb-replica-old",
					leasedAt: "2020-01-01T00:00:00.000Z",
				});

				// Registry has a callback for `ingest` but NOT for SECOND_KIND.
				const resumes = new ResumeRegistry().register("ingest", vi.fn());
				const scheduler = new ManualSweepScheduler();
				const sweeper = new JobOrphanSweeper({
					jobs: store,
					replicaId: "wb-replica-sweep",
					graceMs: 1_000,
					scheduler,
					resumes,
				});
				sweeper.start();
				await scheduler.tick();
				sweeper.stop();

				const after = await store.get(WORKSPACE_A, job.jobId);
				expect(after?.status).toBe("failed");
				expect(after?.errorMessage).toMatch(/no resume hook/);
				expect(after?.leasedBy).toBeNull();
			} finally {
				await cleanup?.();
			}
		});
	});
}
