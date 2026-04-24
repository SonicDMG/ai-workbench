import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FileJobStore } from "../../src/jobs/file-store.js";
import { runJobStoreContract } from "./contract.js";

const WORKSPACE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

runJobStoreContract("file", async () => {
	const root = await mkdtemp(join(tmpdir(), "wb-jobs-"));
	const store = new FileJobStore({ root });
	await store.init();
	return {
		store,
		cleanup: async () => {
			await rm(root, { recursive: true, force: true });
		},
	};
});

describe("FileJobStore — durability across instances", () => {
	test("a second instance over the same root sees prior jobs", async () => {
		const root = await mkdtemp(join(tmpdir(), "wb-jobs-"));
		try {
			const first = new FileJobStore({ root });
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

			// Fresh instance, same root — simulates process restart.
			const second = new FileJobStore({ root });
			await second.init();
			const recovered = await second.get(WORKSPACE_A, job.jobId);
			expect(recovered?.status).toBe("succeeded");
			expect(recovered?.processed).toBe(3);
			expect(recovered?.result).toEqual({ chunks: 3 });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
