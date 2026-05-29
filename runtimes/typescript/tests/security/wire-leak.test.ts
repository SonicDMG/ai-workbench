/**
 * Wire-leak guard (0.4.0 C2).
 *
 * The runtime stores credentials as {@link SecretRef} *pointers*
 * (`env:OPENROUTER_API_KEY`, `file:/run/secrets/...`) — never the
 * resolved value. A secret is only ever materialized in-memory, at use
 * time, by the {@link SecretResolver}; it must never round-trip back out
 * across the HTTP API.
 *
 * This suite pins that invariant for every surface that carries a
 * credential ref:
 *   - LLM / embedding / reranking service records (`credentialRef`)
 *   - external MCP servers (A2's `toWireMcpServer`)
 *   - the unauthenticated `/setup-status` `configuredKeys` projection
 *
 * The shape of the assertion is deliberately blunt: resolve the ref to a
 * known sentinel, then assert the *raw response body text* contains the
 * ref but never the sentinel. A blunt substring check catches a leak no
 * matter which field (or nested object) a regression might surface it in.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../src/app.js";
import { AuthResolver } from "../../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

/**
 * Distinct, high-entropy sentinel values per credential surface. Each is
 * stored under a uniquely-named env var so a leak from one surface can't
 * be masked by a coincidental match against another. The provider-key
 * sentinels are deliberately shaped like real `sk-or-`/`sk-` keys so the
 * leak assertions are realistic — hence the `secret-scan: allow` markers,
 * which tell the very scanner this slice extends that these are fixtures,
 * not committed secrets.
 */
const SENTINELS = {
	llm: "sk-or-v1-wireleak0llm0deadbeefdeadbeefdeadbeefdeadbeef00", // secret-scan: allow
	embedding: "sk-wireleak0embedding0cafebabecafebabecafebabe00", // secret-scan: allow
	reranking: "wireleak0rerank0feedface0feedface0feedface0feed00",
	mcp: "wireleak0mcp0bearer0900af00af00af00af00af00af0000",
	setupStatus: "sk-or-v1-wireleak0setupstatus0abad1deaabad1deaabad00", // secret-scan: allow
} as const;

const ENV_KEYS = {
	llm: "WIRE_LEAK_TEST_LLM",
	embedding: "WIRE_LEAK_TEST_EMBEDDING",
	reranking: "WIRE_LEAK_TEST_RERANKING",
	mcp: "WIRE_LEAK_TEST_MCP",
} as const;

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

function makeApp(): ReturnType<typeof createApp> {
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
	return createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders: makeFakeEmbedderFactory(),
		// `/setup-status` only mounts when an auth config is present (it
		// bypasses the workspace auth middleware and applies its own gate).
		authConfig: {
			mode: "disabled",
			anonymousPolicy: "allow",
			acknowledgeOpenAccess: false,
			bootstrapTokenRef: null,
		},
	});
}

type AppHandle = ReturnType<typeof createApp>;

async function createWorkspace(app: AppHandle): Promise<string> {
	const res = await app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status, await res.clone().text()).toBe(201);
	return (await json(res)).workspaceId as string;
}

/**
 * POST → GET round-trip for a credential-carrying surface, asserting the
 * `credentialRef` survives on both the create and read response while the
 * resolved secret never appears in either body.
 */
async function assertRefNotValue(opts: {
	readonly app: AppHandle;
	readonly createPath: string;
	readonly idField: string;
	readonly body: Record<string, unknown>;
	readonly ref: string;
	readonly secret: string;
}): Promise<void> {
	const post = await opts.app.request(opts.createPath, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(opts.body),
	});
	const postText = await post.clone().text();
	expect(post.status, postText).toBe(201);
	const created = await json(post);
	const id = created[opts.idField] as string;
	expect(id, "create response should carry the record id").toBeTruthy();

	// The pointer is exposed (so the UI can show which ref a service uses)…
	expect(created.credentialRef).toBe(opts.ref);
	// …but the resolved value never crosses the wire.
	expect(postText).toContain(opts.ref);
	expect(postText).not.toContain(opts.secret);

	const get = await opts.app.request(`${opts.createPath}/${id}`);
	const getText = await get.clone().text();
	expect(get.status, getText).toBe(200);
	const fetched = await json(get);
	expect(fetched.credentialRef).toBe(opts.ref);
	expect(getText).toContain(opts.ref);
	expect(getText).not.toContain(opts.secret);

	// And the list projection (same serdes) stays clean too.
	const list = await opts.app.request(opts.createPath);
	const listText = await list.clone().text();
	expect(list.status, listText).toBe(200);
	expect(listText).toContain(opts.ref);
	expect(listText).not.toContain(opts.secret);
}

describe("wire-leak guard — secret values never cross the API boundary", () => {
	beforeEach(() => {
		process.env[ENV_KEYS.llm] = SENTINELS.llm;
		process.env[ENV_KEYS.embedding] = SENTINELS.embedding;
		process.env[ENV_KEYS.reranking] = SENTINELS.reranking;
		process.env[ENV_KEYS.mcp] = SENTINELS.mcp;
	});

	afterEach(() => {
		for (const key of Object.values(ENV_KEYS)) delete process.env[key];
		delete process.env.OPENROUTER_API_KEY;
	});

	test("the SecretResolver actually resolves each ref to its sentinel", async () => {
		// Guards the negative assertions below: if a ref silently resolved
		// to "" the `not.toContain` checks would pass vacuously. Proving the
		// resolver returns the sentinel makes the leak checks meaningful.
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		expect(await secrets.resolve(`env:${ENV_KEYS.llm}`)).toBe(SENTINELS.llm);
		expect(await secrets.resolve(`env:${ENV_KEYS.embedding}`)).toBe(
			SENTINELS.embedding,
		);
		expect(await secrets.resolve(`env:${ENV_KEYS.reranking}`)).toBe(
			SENTINELS.reranking,
		);
		expect(await secrets.resolve(`env:${ENV_KEYS.mcp}`)).toBe(SENTINELS.mcp);
	});

	test("LLM service exposes credentialRef but never the resolved secret", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		await assertRefNotValue({
			app,
			createPath: `/api/v1/workspaces/${ws}/llm-services`,
			idField: "llmServiceId",
			// `ollama` skips the config-time probe (no credential needed), so
			// the ref is persisted without a network round-trip.
			body: {
				name: "leak-llm",
				provider: "ollama",
				modelName: "llama3.1",
				credentialRef: `env:${ENV_KEYS.llm}`,
			},
			ref: `env:${ENV_KEYS.llm}`,
			secret: SENTINELS.llm,
		});
	});

	test("embedding service exposes credentialRef but never the resolved secret", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		await assertRefNotValue({
			app,
			createPath: `/api/v1/workspaces/${ws}/embedding-services`,
			idField: "embeddingServiceId",
			body: {
				name: "leak-embedding",
				provider: "mock",
				modelName: "mock-embedder",
				embeddingDimension: 4,
				credentialRef: `env:${ENV_KEYS.embedding}`,
			},
			ref: `env:${ENV_KEYS.embedding}`,
			secret: SENTINELS.embedding,
		});
	});

	test("reranking service exposes credentialRef but never the resolved secret", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		await assertRefNotValue({
			app,
			createPath: `/api/v1/workspaces/${ws}/reranking-services`,
			idField: "rerankingServiceId",
			body: {
				name: "leak-rerank",
				provider: "cohere",
				modelName: "rerank-3",
				credentialRef: `env:${ENV_KEYS.reranking}`,
			},
			ref: `env:${ENV_KEYS.reranking}`,
			secret: SENTINELS.reranking,
		});
	});

	test("MCP server (A2 toWireMcpServer) exposes credentialRef but never the resolved secret", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		await assertRefNotValue({
			app,
			createPath: `/api/v1/workspaces/${ws}/mcp-servers`,
			idField: "mcpServerId",
			body: {
				label: "Leak MCP",
				url: "https://mcp.example.com/mcp",
				credentialRef: `env:${ENV_KEYS.mcp}`,
				allowedTools: ["search"],
			},
			ref: `env:${ENV_KEYS.mcp}`,
			secret: SENTINELS.mcp,
		});
	});

	test("PATCH on a service never echoes the resolved secret", async () => {
		// A regression could leak through the update path even if create/get
		// are clean (different serializer call site). Cover it explicitly.
		const app = makeApp();
		const ws = await createWorkspace(app);
		const post = await app.request(`/api/v1/workspaces/${ws}/llm-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "leak-llm-patch",
				provider: "ollama",
				modelName: "llama3.1",
				credentialRef: `env:${ENV_KEYS.llm}`,
			}),
		});
		expect(post.status, await post.clone().text()).toBe(201);
		const id = (await json(post)).llmServiceId as string;

		const patch = await app.request(
			`/api/v1/workspaces/${ws}/llm-services/${id}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ description: "rotated label only" }),
			},
		);
		const patchText = await patch.clone().text();
		expect(patch.status, patchText).toBe(200);
		expect(patchText).toContain(`env:${ENV_KEYS.llm}`);
		expect(patchText).not.toContain(SENTINELS.llm);
	});

	test("/setup-status reports configured keys by name, never by value", async () => {
		// `configuredKeys` is presence-only: it lists which managed env keys
		// resolve to a non-empty value, so the settings UI can confirm a
		// credential is set without ever reading it back.
		process.env.OPENROUTER_API_KEY = SENTINELS.setupStatus;
		const app = makeApp();
		const res = await app.request("/setup-status");
		const text = await res.clone().text();
		expect(res.status, text).toBe(200);
		const body = await json(res);

		// The key NAME is reported as configured…
		expect(body.managedEnv.configuredKeys).toContain("OPENROUTER_API_KEY");
		expect(body.hasChatProvider).toBeTypeOf("boolean");
		// …but the secret VALUE never appears anywhere in the body.
		expect(text).not.toContain(SENTINELS.setupStatus);
	});
});
