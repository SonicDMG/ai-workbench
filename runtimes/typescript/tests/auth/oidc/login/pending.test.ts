import { describe, expect, test } from "vitest";
import { MemoryPendingLoginStore } from "../../../../src/auth/oidc/login/pending.js";

describe("MemoryPendingLoginStore", () => {
	test("take() returns a put() value exactly once", () => {
		const store = new MemoryPendingLoginStore();
		store.put("state-1", {
			verifier: "v",
			nonce: "n",
			redirectAfter: "/",
			createdAt: Date.now(),
		});
		expect(store.take("state-1")?.verifier).toBe("v");
		expect(store.take("state-1")).toBe(null);
	});

	test("take() returns null for unknown state", () => {
		const store = new MemoryPendingLoginStore();
		expect(store.take("nope")).toBe(null);
	});

	test("expired entries are treated as not-found", () => {
		let now = 1_000_000;
		const store = new MemoryPendingLoginStore({
			ttlMs: 1000,
			now: () => now,
		});
		store.put("s", {
			verifier: "v",
			nonce: "n",
			redirectAfter: "/",
			createdAt: now,
		});
		now += 1_500;
		expect(store.take("s")).toBe(null);
	});

	test("evicts the oldest entry when maxEntries is exceeded", () => {
		const store = new MemoryPendingLoginStore({ maxEntries: 2 });
		store.put("a", {
			verifier: "va",
			nonce: "na",
			redirectAfter: "/",
			createdAt: Date.now(),
		});
		store.put("b", {
			verifier: "vb",
			nonce: "nb",
			redirectAfter: "/",
			createdAt: Date.now(),
		});
		store.put("c", {
			verifier: "vc",
			nonce: "nc",
			redirectAfter: "/",
			createdAt: Date.now(),
		});
		expect(store.take("a")).toBe(null);
		expect(store.take("b")?.verifier).toBe("vb");
		expect(store.take("c")?.verifier).toBe("vc");
	});
});
