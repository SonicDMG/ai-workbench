import { describe, expect, test } from "vitest";
import { mintToken, verifyToken } from "../../src/auth/apiKey/token.js";
import { ApiKeyVerifier } from "../../src/auth/apiKey/verifier.js";
import { UnauthorizedError } from "../../src/auth/errors.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";

async function seedKey(
	store: MemoryControlPlaneStore,
	label = "ci",
): Promise<{
	readonly plaintext: string;
	readonly workspace: string;
	readonly keyId: string;
}> {
	const ws = await store.createWorkspace({ name: "w", kind: "mock" });
	const minted = await mintToken();
	const record = await store.persistApiKey(ws.uid, {
		keyId: "00000000-0000-0000-0000-0000000000aa",
		prefix: minted.prefix,
		hash: minted.hash,
		label,
	});
	return {
		plaintext: minted.plaintext,
		workspace: ws.uid,
		keyId: record.keyId,
	};
}

describe("mintToken / verifyToken", () => {
	test("mintToken emits the documented wire shape", async () => {
		const minted = await mintToken();
		expect(minted.plaintext).toMatch(/^wb_live_[a-z0-9]{12}_[a-z0-9]{32}$/);
		expect(minted.prefix).toMatch(/^[a-z0-9]{12}$/);
		expect(minted.hash.startsWith("scrypt$")).toBe(true);
	});

	test("verifyToken round-trips", async () => {
		const minted = await mintToken();
		expect(await verifyToken(minted.plaintext, minted.hash)).toBe(true);
	});

	test("verifyToken rejects a different plaintext", async () => {
		const minted = await mintToken();
		const other = await mintToken();
		expect(await verifyToken(other.plaintext, minted.hash)).toBe(false);
	});

	test("verifyToken returns false on malformed storage", async () => {
		expect(await verifyToken("wb_live_xxx", "not-an-scrypt-hash")).toBe(false);
		expect(await verifyToken("wb_live_xxx", "scrypt$xx$yy")).toBe(false);
	});
});

describe("ApiKeyVerifier", () => {
	test("returns null for a token whose shape isn't wb_live_*", async () => {
		const store = new MemoryControlPlaneStore();
		const verifier = new ApiKeyVerifier({ store });
		expect(await verifier.verify("some-jwt.payload.signature")).toBeNull();
	});

	test("returns an AuthSubject for a live, valid token", async () => {
		const store = new MemoryControlPlaneStore();
		const { plaintext, workspace, keyId } = await seedKey(store);
		const verifier = new ApiKeyVerifier({ store });
		const subject = await verifier.verify(plaintext);
		expect(subject).toMatchObject({
			type: "apiKey",
			id: keyId,
			workspaceScopes: [workspace],
		});
	});

	test("throws unauthorized when the prefix isn't recognized", async () => {
		const store = new MemoryControlPlaneStore();
		const verifier = new ApiKeyVerifier({ store });
		await expect(
			verifier.verify(`wb_live_${"x".repeat(12)}_${"y".repeat(32)}`),
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	test("throws unauthorized when the key has been revoked", async () => {
		const store = new MemoryControlPlaneStore();
		const { plaintext, workspace, keyId } = await seedKey(store);
		await store.revokeApiKey(workspace, keyId);
		const verifier = new ApiKeyVerifier({ store });
		await expect(verifier.verify(plaintext)).rejects.toThrow(/revoked/);
	});

	test("throws unauthorized when the key has expired", async () => {
		const store = new MemoryControlPlaneStore();
		const minted = await mintToken();
		const ws = await store.createWorkspace({ name: "w", kind: "mock" });
		await store.persistApiKey(ws.uid, {
			keyId: "00000000-0000-0000-0000-0000000000aa",
			prefix: minted.prefix,
			hash: minted.hash,
			label: "expired",
			expiresAt: "2000-01-01T00:00:00.000Z",
		});
		const verifier = new ApiKeyVerifier({
			store,
			now: () => new Date("2026-01-01T00:00:00.000Z"),
		});
		await expect(verifier.verify(minted.plaintext)).rejects.toThrow(/expired/);
	});

	test("touches lastUsedAt on successful verify", async () => {
		const store = new MemoryControlPlaneStore();
		const { plaintext, workspace, keyId } = await seedKey(store);
		const verifier = new ApiKeyVerifier({ store });
		await verifier.verify(plaintext);
		// touchApiKey is fire-and-forget; give the microtask a tick.
		await new Promise((r) => setImmediate(r));
		const rec = await store.getApiKey(workspace, keyId);
		expect(rec?.lastUsedAt).not.toBeNull();
	});
});
