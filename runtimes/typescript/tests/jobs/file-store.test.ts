import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

	test("a row persisted with the legacy `ingestInput` field migrates to `inputSnapshot` (back-compat)", async () => {
		// D2 back-compat: jobs written before the rename carry
		// `ingestInput` (no `inputSnapshot`). Reading must surface the
		// old value under the new field so the sweeper can still resume.
		const root = await mkdtemp(join(tmpdir(), "wb-jobs-legacy-"));
		try {
			const jobId = "00000000-0000-4000-8000-00000000abcd";
			const legacyRow = {
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
				// Legacy field name, no `inputSnapshot` present.
				ingestInput: { text: "from before the rename" },
			};
			await writeFile(
				join(root, "jobs.json"),
				JSON.stringify([legacyRow], null, 2),
				"utf8",
			);

			const store = new FileJobStore({ root });
			await store.init();
			const recovered = await store.get(WORKSPACE_A, jobId);
			expect(recovered?.inputSnapshot).toEqual({
				text: "from before the rename",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
