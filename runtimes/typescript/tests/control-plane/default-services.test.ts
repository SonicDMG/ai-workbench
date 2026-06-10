import { describe, expect, test } from "vitest";
import {
	DEFAULT_SERVICES,
	MOCK_WORKSPACE_SEED_SERVICES,
} from "../../src/control-plane/default-services.js";
import { buildControlPlane } from "../../src/control-plane/factory.js";
import { SecretResolver } from "../../src/secrets/provider.js";

const secrets = new SecretResolver({
	env: { resolve: (path) => Promise.reject(new Error(`missing ${path}`)) },
});

describe("DEFAULT_SERVICES", () => {
	test("ships at least one chunking + one embedding preset", () => {
		expect(DEFAULT_SERVICES.chunking.length).toBeGreaterThan(0);
		expect(DEFAULT_SERVICES.embedding.length).toBeGreaterThan(0);
	});

	test("recursive-char chunker is the first chunking preset", () => {
		expect(DEFAULT_SERVICES.chunking[0]?.name).toBe("recursive-char-1000");
		expect(DEFAULT_SERVICES.chunking[0]?.engine).toBe("langchain_ts");
		expect(DEFAULT_SERVICES.chunking[0]?.strategy).toBe("recursive");
	});

	test("openrouter-text-embedding-3-small is the default (first) embedding preset", () => {
		const first = DEFAULT_SERVICES.embedding[0];
		expect(first?.name).toBe("openrouter-text-embedding-3-small");
		expect(first?.provider).toBe("openrouter");
		expect(first?.embeddingDimension).toBe(1536);
	});

	test("no docling preset in v1 seeds", () => {
		const dockingChunkers = DEFAULT_SERVICES.chunking.filter(
			(c) => c.engine === "docling",
		);
		expect(dockingChunkers).toHaveLength(0);
	});
});

describe("memory control plane seeding", () => {
	test("each seeded workspace gets the default chunking + embedding services", async () => {
		const { store } = await buildControlPlane({
			controlPlane: { driver: "memory" },
			seedWorkspaces: [{ name: "demo", kind: "mock" }],
			secrets,
		});
		const workspaces = await store.listWorkspaces();
		expect(workspaces).toHaveLength(1);
		const ws = workspaces[0];
		if (!ws) return;
		const chunking = await store.listChunkingServices(ws.uid);
		const embedding = await store.listEmbeddingServices(ws.uid);
		expect(chunking.map((c) => c.name).sort()).toEqual(
			DEFAULT_SERVICES.chunking.map((c) => c.name).sort(),
		);
		// Mock-kind seed workspaces get the credential-free mock embedder
		// in addition to the full catalog — the mock driver only accepts
		// text upsert from `provider: "mock"` (#363).
		expect(embedding.map((e) => e.name).sort()).toEqual(
			[...MOCK_WORKSPACE_SEED_SERVICES.embedding, ...DEFAULT_SERVICES.embedding]
				.map((e) => e.name)
				.sort(),
		);
	});

	test("workspaces with no seeds get no services (services seed only on workspace seed)", async () => {
		const { store } = await buildControlPlane({
			controlPlane: { driver: "memory" },
			seedWorkspaces: [],
			secrets,
		});
		expect(await store.listWorkspaces()).toHaveLength(0);
	});
});
