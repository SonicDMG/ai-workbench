import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { SqliteJobStore } from "../../src/jobs/sqlite-store.js";
import { runJobStoreContract } from "./contract.js";

const WORKSPACE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// The same shared JobStore contract the memory/file/astra backends run.
runJobStoreContract("sqlite", async () => {
	const dir = await mkdtemp(join(tmpdir(), "wb-jobs-sqlite-"));
	const store = new SqliteJobStore({ path: join(dir, "jobs.db") });
	await store.init();
	return {
		store,
		cleanup: async () => {
			store.stop();
			await rm(dir, { recursive: true, force: true });
		},
	};
});

describe("SqliteJobStore — durability across instances", () => {
	test("a second instance over the same file sees prior jobs", async () => {
		const dir = await mkdtemp(join(tmpdir(), "wb-jobs-sqlite-"));
		const path = join(dir, "jobs.db");
		try {
			const first = new SqliteJobStore({ path });
			await first.init();
			const job = await first.create({
				workspace: WORKSPACE_A,
				kind: "ingest",
			});
			await first.update(WORKSPACE_A, job.jobId, {
				status: "succeeded",
				processed: 3,
				total: 3,
				result: { chunks: 3 },
			});
			first.stop();

			// Fresh instance, same file — simulates process restart.
			const second = new SqliteJobStore({ path });
			await second.init();
			const recovered = await second.get(WORKSPACE_A, job.jobId);
			expect(recovered?.status).toBe("succeeded");
			expect(recovered?.processed).toBe(3);
			expect(recovered?.result).toEqual({ chunks: 3 });
			second.stop();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a row stored with the legacy `ingestInput` field migrates to `inputSnapshot` (back-compat)", async () => {
		// D2 back-compat: rows whose `data` blob predates the rename
		// carry `ingestInput` (no `inputSnapshot`). Hydration must
		// surface the old value under the new field so the sweeper can
		// still resume.
		const dir = await mkdtemp(join(tmpdir(), "wb-jobs-sqlite-legacy-"));
		const path = join(dir, "jobs.db");
		try {
			const jobId = "00000000-0000-4000-8000-00000000face";
			// Seed a legacy `data` blob with a raw connection, mirroring
			// the store's own schema.
			const seed = new Database(path);
			seed.exec(
				`CREATE TABLE IF NOT EXISTS jobs (
					workspace TEXT NOT NULL,
					job_id TEXT NOT NULL,
					data TEXT NOT NULL,
					PRIMARY KEY (workspace, job_id)
				)`,
			);
			const legacyData = {
				workspace: WORKSPACE_A,
				jobId,
				kind: "ingest",
				knowledgeBaseId: null,
				documentId: null,
				status: "running",
				processed: 0,
				total: null,
				result: null,
				errorMessage: null,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				leasedBy: "wb-replica-old",
				leasedAt: "2026-01-01T00:00:00.000Z",
				// Legacy field name, no `inputSnapshot`.
				ingestInput: { text: "blob from before the rename" },
			};
			seed
				.prepare(`INSERT INTO jobs (workspace, job_id, data) VALUES (?, ?, ?)`)
				.run(WORKSPACE_A, jobId, JSON.stringify(legacyData));
			seed.close();

			const store = new SqliteJobStore({ path });
			await store.init();
			const recovered = await store.get(WORKSPACE_A, jobId);
			expect(recovered?.inputSnapshot).toEqual({
				text: "blob from before the rename",
			});
			store.stop();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
