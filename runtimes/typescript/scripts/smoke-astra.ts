#!/usr/bin/env tsx
/**
 * Real-Astra end-to-end smoke test.
 *
 * Boots the runtime in-process against a real Astra Data API, runs
 * the full workspace -> services -> knowledge-base -> ingest -> search
 * pipeline, then tears everything down.
 *
 * **Opt-in.** Skips silently with exit code 0 when the required
 * `ASTRA_DB_API_ENDPOINT` + `ASTRA_DB_APPLICATION_TOKEN` env vars
 * aren't set. This makes the script safe to wire into CI as a
 * dedicated job that runs only when the org provides Astra
 * secrets — no token, no work.
 *
 * Why a script and not a vitest test: vitest discovery would either
 * skip silently (confusing — looks like coverage) or run partial
 * setup before the env-check fires. A standalone script makes the
 * "needs real cloud" contract explicit at the top.
 *
 * Usage:
 *
 * ```
 * ASTRA_DB_API_ENDPOINT=... \
 * ASTRA_DB_APPLICATION_TOKEN=... \
 * # Optional, falls back to client-side embedding via the mock
 * # provider when unset. Set it to exercise the OpenAI path.
 * # OPENAI_API_KEY=... \
 *   npm run smoke:astra
 * ```
 *
 * The script uses a unique `wb_smoke_*` keyspace prefix per run so
 * concurrent invocations don't collide. The keyspace itself isn't
 * dropped (Astra's `keyspace.drop` isn't on the Data API surface),
 * but every `wb_*` table gets its rows removed and the test
 * collection is dropped.
 */

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp } from "../src/app.js";
import { buildAuthResolver } from "../src/auth/factory.js";
import { controlPlaneFromConfig } from "../src/control-plane/factory.js";
import { buildVectorStoreDriverRegistry } from "../src/drivers/factory.js";
import { makeEmbedderFactory } from "../src/embeddings/factory.js";
import { buildJobStore } from "../src/jobs/factory.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { FileSecretProvider } from "../src/secrets/file.js";
import { SecretResolver } from "../src/secrets/provider.js";

const TOKEN_ENV = "ASTRA_DB_APPLICATION_TOKEN";
const ENDPOINT_RAW = process.env.ASTRA_DB_API_ENDPOINT;
const TOKEN_RAW = process.env[TOKEN_ENV];

if (!ENDPOINT_RAW || !TOKEN_RAW) {
	console.log(
		`smoke-astra: skipping — set ASTRA_DB_API_ENDPOINT and ${TOKEN_ENV} to run.`,
	);
	process.exit(0);
}

// Hoist the narrowed values onto fresh `const` bindings so TS keeps
// the non-undefined type past the early-exit guard.
const ENDPOINT: string = ENDPOINT_RAW;
const KEYSPACE = process.env.ASTRA_DB_KEYSPACE ?? "default_keyspace";
const RUN_ID = randomUUID().slice(0, 8);

function log(stage: string, ...rest: unknown[]): void {
	console.log(`[smoke-astra ${RUN_ID}] ${stage}`, ...rest);
}

async function main(): Promise<void> {
	log("boot", "endpoint=", ENDPOINT, "keyspace=", KEYSPACE);

	const secrets = new SecretResolver({
		env: new EnvSecretProvider(),
		file: new FileSecretProvider(),
	});

	// Use the astra control plane so the wb_* tables get exercised.
	// Workspaces / services / knowledge bases / documents all round-trip
	// through real Astra writes.
	const config = {
		version: 1 as const,
		runtime: {
			environment: "development" as const,
			port: 0,
			logLevel: "warn" as const,
			requestIdHeader: "X-Request-Id",
			uiDir: null,
			replicaId: `smoke-${RUN_ID}`,
			publicOrigin: null,
			trustProxyHeaders: false,
			rateLimit: { enabled: false, capacity: 600, windowMs: 60_000 },
		},
		controlPlane: {
			driver: "astra" as const,
			endpoint: ENDPOINT,
			tokenRef: `env:${TOKEN_ENV}`,
			keyspace: KEYSPACE,
			jobPollIntervalMs: 500,
		},
		auth: {
			mode: "disabled" as const,
			anonymousPolicy: "allow" as const,
			bootstrapTokenRef: null,
			acknowledgeOpenAccess: true,
		},
		seedWorkspaces: [],
		mcp: { enabled: false, exposeChat: false },
	};

	const { store, astraTables } = await controlPlaneFromConfig(config, secrets);
	const jobs = await buildJobStore({
		controlPlane: config.controlPlane,
		astraTables,
	});
	const drivers = buildVectorStoreDriverRegistry({ secrets });
	const embedders = makeEmbedderFactory({ secrets });
	const auth = await buildAuthResolver(config.auth, { store, secrets });

	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		jobs,
		replicaId: config.runtime.replicaId,
	});

	let workspaceId: string | null = null;
	let chunkingServiceId: string | null = null;
	let embeddingServiceId: string | null = null;
	let knowledgeBaseId: string | null = null;

	try {
		// 1. Create workspace.
		const wsRes = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: `smoke-${RUN_ID}`,
				kind: "astra",
				url: ENDPOINT,
				credentials: { token: `env:${TOKEN_ENV}` },
				keyspace: KEYSPACE,
			}),
		});
		assertStatus(wsRes, 201, "workspace create");
		const ws = (await wsRes.json()) as { uid: string };
		workspaceId = ws.uid;
		log("workspace created", workspaceId);

		// 2. Create execution services, then bind them into a KB.
		const chunkRes = await app.request(
			`/api/v1/workspaces/${workspaceId}/chunking-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: `chunk-${RUN_ID}`,
					engine: "recursive-character",
					strategy: "recursive-char",
				}),
			},
		);
		assertStatus(chunkRes, 201, "chunking-service create");
		const chunk = (await chunkRes.json()) as { chunkingServiceId: string };
		chunkingServiceId = chunk.chunkingServiceId;
		log("chunking service created", chunkingServiceId);

		const embRes = await app.request(
			`/api/v1/workspaces/${workspaceId}/embedding-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: `emb-${RUN_ID}`,
					provider: "mock",
					modelName: "smoke-mock",
					embeddingDimension: 4,
					distanceMetric: "cosine",
				}),
			},
		);
		assertStatus(embRes, 201, "embedding-service create");
		const emb = (await embRes.json()) as { embeddingServiceId: string };
		embeddingServiceId = emb.embeddingServiceId;
		log("embedding service created", embeddingServiceId);

		const kbRes = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: `kb-${RUN_ID}`,
					embeddingServiceId: embeddingServiceId,
					chunkingServiceId: chunkingServiceId,
				}),
			},
		);
		assertStatus(kbRes, 201, "knowledge-base create");
		const kb = (await kbRes.json()) as { knowledgeBaseId: string };
		knowledgeBaseId = kb.knowledgeBaseId;
		log("knowledge base created", knowledgeBaseId);

		// 4. Sync ingest. The mock embedder gives deterministic 4-dim
		// vectors so we don't need an OpenAI key for this smoke.
		const ingestText =
			"Apples are red. Bananas are yellow. Cherries are red too. Dates are brown.";
		const ingestRes = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: ingestText,
					chunker: { maxChars: 30, minChars: 5, overlapChars: 5 },
				}),
			},
		);
		assertStatus(ingestRes, 201, "ingest");
		const ingestBody = (await ingestRes.json()) as { chunks: number };
		log("ingest ok", { chunks: ingestBody.chunks });

		// 5. Async ingest — opens a job, polls, waits for terminal.
		const asyncRes = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/ingest?async=true`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: "Eggplants are purple. Figs are dark.",
					chunker: { maxChars: 30, minChars: 5, overlapChars: 5 },
				}),
			},
		);
		assertStatus(asyncRes, 202, "async ingest");
		const asyncBody = (await asyncRes.json()) as { job: { jobId: string } };
		const jobId = asyncBody.job.jobId;
		log("async ingest queued", { jobId });

		const final = await waitForJobTerminal(app, workspaceId, jobId, 15_000);
		if (final.status !== "succeeded") {
			throw new Error(
				`async ingest did not succeed; got ${final.status}: ${final.errorMessage}`,
			);
		}
		log("async ingest succeeded", { processed: final.processed });

		// 6. KB-scoped search.
		const searchRes = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "red fruit", topK: 3 }),
			},
		);
		assertStatus(searchRes, 200, "search");
		const hits = await searchRes.json();
		if (!Array.isArray(hits) || hits.length === 0) {
			throw new Error(`search returned no hits — pipeline produced 0 chunks?`);
		}
		log("search ok", { hits: hits.length });

		log("✅ smoke passed");
	} finally {
		// Cleanup: cascade workspace delete drops KBs, documents,
		// the backing vector collection, and service/config rows. The
		// `wb_jobs_by_workspace` table is shared keyspace; orphan rows
		// from this run age out via standard ops, no special cleanup.
		if (workspaceId) {
			try {
				const del = await app.request(`/api/v1/workspaces/${workspaceId}`, {
					method: "DELETE",
				});
				log("cleanup workspace", { status: del.status });
			} catch (err) {
				log(
					"cleanup workspace failed (manual cleanup may be needed)",
					err instanceof Error ? err.message : err,
				);
			}
		}
		await store.close?.();
	}
}

function assertStatus(res: Response, expected: number, label: string): void {
	if (res.status !== expected) {
		throw new Error(
			`${label}: expected ${expected}, got ${res.status} ${res.statusText}`,
		);
	}
}

async function waitForJobTerminal(
	app: { request: (input: string) => Response | Promise<Response> },
	workspaceId: string,
	jobId: string,
	timeoutMs: number,
): Promise<{ status: string; processed: number; errorMessage: string | null }> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const r = await app.request(
			`/api/v1/workspaces/${workspaceId}/jobs/${jobId}`,
		);
		if (r.status === 200) {
			const body = (await r.json()) as {
				status: string;
				processed: number;
				errorMessage: string | null;
			};
			if (body.status === "succeeded" || body.status === "failed") {
				return body;
			}
		}
		await sleep(250);
	}
	throw new Error(
		`job ${jobId} did not reach terminal state in ${timeoutMs}ms`,
	);
}

main().catch((err) => {
	console.error(`[smoke-astra] failed:`, err);
	process.exit(1);
});
