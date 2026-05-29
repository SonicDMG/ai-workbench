import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SqliteControlPlaneStore } from "../../src/control-plane/sqlite/store.js";
import { runContract } from "./contract.js";

// Run the full shared control-plane contract against a real on-disk
// SQLite database (WAL) so the same assertions the memory/file/astra
// backends pass also gate sqlite — including the chat-message and
// cascade scenarios that motivate this backend.
runContract("sqlite", async () => {
	const dir = await mkdtemp(join(tmpdir(), "wb-cp-sqlite-"));
	const store = new SqliteControlPlaneStore({ path: join(dir, "cp.db") });
	await store.init?.();
	return {
		store,
		cleanup: async () => {
			await store.close?.();
			await rm(dir, { recursive: true, force: true });
		},
	};
});

describe("SqliteControlPlaneStore — durability across instances", () => {
	test("a second instance over the same file sees prior rows", async () => {
		const dir = await mkdtemp(join(tmpdir(), "wb-cp-sqlite-"));
		const path = join(dir, "cp.db");
		try {
			const first = new SqliteControlPlaneStore({ path });
			await first.init?.();
			const ws = await first.createWorkspace({
				name: "persisted",
				kind: "mock",
			});
			const agent = await first.createAgent(ws.uid, { name: "Helper" });
			const conv = await first.createConversation(ws.uid, agent.agentId, {
				title: "t",
			});
			await first.appendChatMessage(ws.uid, conv.conversationId, {
				role: "user",
				content: "hello",
			});
			await first.close?.();

			// Fresh instance, same file — simulates process restart.
			const second = new SqliteControlPlaneStore({ path });
			await second.init?.();
			const recovered = await second.getWorkspace(ws.uid);
			expect(recovered?.name).toBe("persisted");
			const msgs = await second.listChatMessages(ws.uid, conv.conversationId);
			expect(msgs.map((m) => m.content)).toEqual(["hello"]);
			await second.close?.();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("appending many messages keeps them ordered (row-level writes)", async () => {
		// Exercises the hot path this backend exists for: a streaming
		// chat appends a row at a time. Confirms row-level inserts don't
		// disturb prior rows and the oldest-first ordering holds.
		const store = new SqliteControlPlaneStore({ path: ":memory:" });
		await store.init?.();
		try {
			const ws = await store.createWorkspace({ name: "w", kind: "mock" });
			const agent = await store.createAgent(ws.uid, { name: "Helper" });
			const conv = await store.createConversation(ws.uid, agent.agentId, {
				title: "t",
			});
			for (let i = 0; i < 25; i++) {
				await store.appendChatMessage(ws.uid, conv.conversationId, {
					role: i % 2 === 0 ? "user" : "agent",
					content: `m${i}`,
					messageTs: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(),
				});
			}
			const msgs = await store.listChatMessages(ws.uid, conv.conversationId);
			expect(msgs.map((m) => m.content)).toEqual(
				Array.from({ length: 25 }, (_, i) => `m${i}`),
			);
		} finally {
			await store.close?.();
		}
	});
});
