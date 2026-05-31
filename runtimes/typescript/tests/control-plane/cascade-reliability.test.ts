/**
 * Cascade-reliability tests for the Astra backend (review #7).
 *
 * Astra has no cross-partition transaction, so `deleteWorkspace` removes
 * dependents one partition at a time. These tests fault-inject a
 * mid-cascade `deleteMany` failure and assert the self-healing
 * contract:
 *
 *   1. a partial failure leaves the workspace row INTACT and raises a
 *      retryable {@link ControlPlaneCascadeError} (no stranded orphans),
 *   2. a clean retry completes the idempotent cascade, and
 *   3. {@link reconcileOrphans} mops up dependents left orphaned by an
 *      out-of-band workspace-row deletion (the legacy parent-first path).
 */

import { describe, expect, it } from "vitest";
import { AstraControlPlaneStore } from "../../src/control-plane/astra/store.js";
import { ControlPlaneCascadeError } from "../../src/control-plane/errors.js";
import { createFakeTablesBundle } from "./astra-fake.js";

function seed() {
	const bundle = createFakeTablesBundle();
	const store = new AstraControlPlaneStore(bundle);
	return { bundle, store };
}

const KEY = {
	keyId: "00000000-0000-0000-0000-0000000000aa",
	hash: "scrypt$deadbeef$cafef00d",
	label: "ci",
};

describe("deleteWorkspace cross-partition reliability", () => {
	it("leaves the workspace intact and throws a retryable error on a partial cascade failure", async () => {
		const { bundle, store } = seed();
		const ws = await store.createWorkspace({ name: "doomed", kind: "mock" });
		await store.persistApiKey(ws.uid, { ...KEY, prefix: "faultfaultaa" });

		// One partition's deleteMany rejects mid-cascade (a transient Data
		// API outage). Shadow the instance method.
		const realDeleteMany = bundle.apiKeys.deleteMany.bind(bundle.apiKeys);
		bundle.apiKeys.deleteMany = async () => {
			throw new Error("simulated Data API outage");
		};

		await expect(store.deleteWorkspace(ws.uid)).rejects.toBeInstanceOf(
			ControlPlaneCascadeError,
		);
		// The self-heal property: the workspace row was NOT removed, so the
		// delete is safe to retry and no dependents are permanently stranded.
		expect(await store.getWorkspace(ws.uid)).not.toBeNull();

		// Recover and retry: the idempotent cascade completes cleanly.
		bundle.apiKeys.deleteMany = realDeleteMany;
		expect(await store.deleteWorkspace(ws.uid)).toEqual({ deleted: true });
		expect(await store.getWorkspace(ws.uid)).toBeNull();
		expect(await store.findApiKeyByPrefix("faultfaultaa")).toBeNull();
	});

	it("surfaces the failure count on the cascade error", async () => {
		const { bundle, store } = seed();
		const ws = await store.createWorkspace({ name: "doomed2", kind: "mock" });
		bundle.knowledgeBases.deleteMany = async () => {
			throw new Error("boom");
		};
		const err = await store.deleteWorkspace(ws.uid).catch((e) => e);
		expect(err).toBeInstanceOf(ControlPlaneCascadeError);
		expect((err as ControlPlaneCascadeError).failed).toBeGreaterThanOrEqual(1);
		expect((err as ControlPlaneCascadeError).resource).toBe("workspace");
	});
});

describe("reconcileOrphans", () => {
	it("sweeps dependents stranded by an out-of-band workspace-row deletion", async () => {
		const { bundle, store } = seed();
		const ws = await store.createWorkspace({ name: "ghosted", kind: "mock" });
		await store.persistApiKey(ws.uid, { ...KEY, prefix: "orphanorphan" });

		// Simulate the legacy parent-first failure: the workspace row is
		// gone but its dependents were stranded.
		await bundle.workspaces.deleteOne({ uid: ws.uid });
		expect(
			(await bundle.apiKeys.find({ workspace: ws.uid }).toArray()).length,
		).toBe(1);

		const report = await store.reconcileOrphans?.();
		expect(report).toEqual({ workspaces: 1, partialFailures: 0 });
		expect(
			(await bundle.apiKeys.find({ workspace: ws.uid }).toArray()).length,
		).toBe(0);
		expect(await store.findApiKeyByPrefix("orphanorphan")).toBeNull();
	});

	it("reports a partial failure when an orphan's sweep still fails", async () => {
		const { bundle, store } = seed();
		const ws = await store.createWorkspace({ name: "stuck", kind: "mock" });
		await store.persistApiKey(ws.uid, { ...KEY, prefix: "stuckstuckaa" });
		await bundle.workspaces.deleteOne({ uid: ws.uid });
		// The orphan is detected, but its dependent sweep keeps failing.
		bundle.apiKeys.deleteMany = async () => {
			throw new Error("still down");
		};
		expect(await store.reconcileOrphans?.()).toEqual({
			workspaces: 1,
			partialFailures: 1,
		});
	});

	it("is a no-op when there is nothing to reconcile", async () => {
		const { store } = seed();
		const ws = await store.createWorkspace({ name: "healthy", kind: "mock" });
		await store.persistApiKey(ws.uid, { ...KEY, prefix: "stillaliveaa" });
		// A live workspace's dependents are never treated as orphans.
		expect(await store.reconcileOrphans?.()).toEqual({
			workspaces: 0,
			partialFailures: 0,
		});
		expect(await store.findApiKeyByPrefix("stillaliveaa")).not.toBeNull();
	});
});
