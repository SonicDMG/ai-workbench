import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
