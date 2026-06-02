import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import { makeFakeChatService } from "./helpers/chat.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

function makeApp(opts: { withChat?: boolean } = {}) {
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "disabled",
		anonymousPolicy: "allow",
		verifiers: [],
	});
	const chatService = opts.withChat ? makeFakeChatService() : null;
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders: makeFakeEmbedderFactory(),
		chatService,
	});
	return { app, store };
}

describe("health routes", () => {
	let appUnderTest: ReturnType<typeof makeApp>;

	beforeEach(() => {
		appUnderTest = makeApp({ withChat: true });
	});

	afterEach(() => {
		// no global state to reset
	});

	test("GET /health/details probes the control plane and chat provider", async () => {
		const { app } = appUnderTest;
		const res = await app.request("/health/details");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			controlPlane: { status: string; detail: string };
			chat: { status: string; detail: string };
			ingest: { active: number; queued: number; capacity: number } | null;
			recentErrors: { capacity: number; count: number };
		};
		expect(body.controlPlane.status).toBe("ok");
		expect(body.controlPlane.detail).toMatch(/workspace/);
		// Fake chat service has no `ping`, so the probe reports ok with the
		// "(no provider ping; configured)" detail.
		expect(body.chat.status).toBe("ok");
		expect(body.chat.detail).toContain("fake");
		expect(body.ingest).not.toBeNull();
		expect(body.recentErrors.capacity).toBeGreaterThan(0);
	});

	test("GET /health/details reports chat as down when no service is wired", async () => {
		const { app } = makeApp({ withChat: false });
		const res = await app.request("/health/details");
		const body = (await res.json()) as {
			chat: { status: string; detail: string };
		};
		expect(body.chat.status).toBe("down");
		expect(body.chat.detail).toMatch(/no chat service/);
	});

	test("GET /health/recent-errors starts empty and grows after an error", async () => {
		const { app } = appUnderTest;
		const empty = await app.request("/health/recent-errors");
		const emptyBody = (await empty.json()) as {
			entries: unknown[];
		};
		expect(emptyBody.entries).toEqual([]);

		// Force a real error envelope by hitting an unknown workspace.
		await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000",
		);

		const populated = await app.request("/health/recent-errors");
		const body = (await populated.json()) as {
			entries: {
				code: string;
				status: number;
				method: string;
				routePattern: string;
				requestId: string;
				ts: string;
			}[];
		};
		expect(body.entries.length).toBeGreaterThan(0);
		const latest = body.entries[0];
		expect(latest?.code).toBe("workspace_not_found");
		expect(latest?.status).toBe(404);
		expect(latest?.method).toBe("GET");
		expect(latest?.routePattern).toContain("workspaces");
	});

	test("GET /metrics includes the new curated counters", async () => {
		const { app } = appUnderTest;
		const res = await app.request("/metrics");
		const body = await res.text();
		expect(body).toContain("workbench_chat_requests_total");
		expect(body).toContain("workbench_ingest_documents_total");
		expect(body).toContain("workbench_search_requests_total");
		expect(body).toContain("workbench_search_duration_seconds");
	});
});
