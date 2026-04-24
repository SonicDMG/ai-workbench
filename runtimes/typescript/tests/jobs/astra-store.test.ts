import { describe, expect, test } from "vitest";
import { AstraJobStore } from "../../src/jobs/astra-store.js";
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
