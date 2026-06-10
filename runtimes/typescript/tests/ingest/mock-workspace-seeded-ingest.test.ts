/**
 * Regression for #363: ingest on a freshly created `kind: "mock"`
 * workspace must work with ONLY the auto-seeded services — no
 * hand-created embedding service, no provider credentials.
 *
 * Before the fix, mock workspaces were seeded with the NVIDIA
 * embedder (`credentialRef: null`, provider not credential-free), so
 * the KB form forced a choice that could never ingest: the real
 * {@link makeEmbedderFactory} threw `EmbedderUnavailableError` and
 * the route surfaced 400 `embedding_unavailable`. Unlike the rest of
 * the route suites this file deliberately uses the REAL embedder
 * factory — a fake factory would mask exactly the failure being
 * pinned here.
 */

import { describe, expect, test } from "vitest";
import { createApp } from "../../src/app.js";
import { AuthResolver } from "../../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { makeEmbedderFactory } from "../../src/embeddings/factory.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

function makeApp() {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "disabled",
		anonymousPolicy: "allow",
		verifiers: [],
	});
	// Real factory: resolves credentials for real providers, builds the
	// in-process mock embedder for `provider: "mock"`.
	const embedders = makeEmbedderFactory({ secrets });
	return createApp({ store, drivers, secrets, auth, embedders });
}

describe("mock workspace seeded ingest (#363)", () => {
	test("ingest succeeds with only the auto-seeded services and no credentials", async () => {
		const app = makeApp();

		const wsRes = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "mock-ws", kind: "mock" }),
		});
		expect(wsRes.status).toBe(201);
		const ws = (await json(wsRes)).workspaceId as string;

		// Pick the services the workspace POST seeded — nothing else.
		const embedders = (
			await json(
				await app.request(`/api/v1/workspaces/${ws}/embedding-services`),
			)
		).items as Array<{ embeddingServiceId: string; provider: string }>;
		const mockEmb = embedders.find((e) => e.provider === "mock");
		expect(mockEmb, "mock workspace should seed a mock embedder").toBeDefined();

		const chunkers = (
			await json(
				await app.request(`/api/v1/workspaces/${ws}/chunking-services`),
			)
		).items as Array<{ chunkingServiceId: string; strategy: string | null }>;
		const recursive = chunkers.find((c) => c.strategy === "recursive");
		expect(recursive).toBeDefined();

		const kbRes = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "kb",
					embeddingServiceId: mockEmb?.embeddingServiceId,
					chunkingServiceId: recursive?.chunkingServiceId,
				}),
			},
		);
		expect(kbRes.status, await kbRes.clone().text()).toBe(201);
		const kbId = (await json(kbRes)).knowledgeBaseId as string;

		const ingest = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceFilename: "notes.txt",
					text: "alpha bravo charlie delta echo foxtrot golf hotel india juliett",
				}),
			},
		);
		// Pre-fix this returned 400 `embedding_unavailable`
		// ("embedding.secretRef is null — cannot call the provider
		// without credentials").
		expect(ingest.status, await ingest.clone().text()).toBe(201);
		const body = await json(ingest);
		expect(body.chunks).toBeGreaterThan(0);
		expect(body.document.status).toBe("ready");
	});
});
