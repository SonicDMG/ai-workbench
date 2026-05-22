import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

function makeSetupApp(opts: {
	dataDir: string;
	authMode?: "disabled" | "apiKey";
	bootstrapToken?: string;
	triggerRestart?: () => void;
}) {
	process.env.WORKBENCH_DATA_DIR = opts.dataDir;
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: opts.authMode ?? "disabled",
		anonymousPolicy: "allow",
		verifiers: [],
	});
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders: makeFakeEmbedderFactory(),
		authConfig: {
			mode: opts.authMode ?? "disabled",
			anonymousPolicy: "allow",
			acknowledgeOpenAccess: false,
			bootstrapTokenRef: opts.bootstrapToken
				? "env:WB_BOOTSTRAP_TOKEN_TEST"
				: null,
		},
		triggerRestart: opts.triggerRestart,
	});
	if (opts.bootstrapToken) {
		process.env.WB_BOOTSTRAP_TOKEN_TEST = opts.bootstrapToken;
	}
	return { app, store };
}

describe("setup routes", () => {
	let dataDir: string;

	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), "aiw-setup-"));
	});

	afterEach(() => {
		delete process.env.WORKBENCH_DATA_DIR;
		delete process.env.WB_BOOTSTRAP_TOKEN_TEST;
		rmSync(dataDir, { recursive: true, force: true });
	});

	test("GET /setup-status reports an empty install as not-complete", async () => {
		const { app } = makeSetupApp({ dataDir });
		const res = await app.request("/setup-status");
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown> & {
			error?: { code?: string; message?: string };
		};
		expect(body).toMatchObject({
			setupComplete: false,
			workspacesCount: 0,
			controlPlane: { kind: "memory", healthy: true },
			managedEnv: {
				path: join(dataDir, ".env"),
				writable: true,
				present: false,
			},
		});
	});

	test("GET /setup-status flips setupComplete once a workspace exists", async () => {
		const { app, store } = makeSetupApp({ dataDir });
		await store.createWorkspace({ name: "ws1", kind: "mock" });
		const res = await app.request("/setup-status");
		const body = (await res.json()) as Record<string, unknown> & {
			error?: { code?: string; message?: string };
		};
		expect(body.setupComplete).toBe(true);
		expect(body.workspacesCount).toBe(1);
	});

	test("POST /setup/env writes the managed file with 0600 (fresh install, auth disabled)", async () => {
		const { app } = makeSetupApp({ dataDir });
		const res = await app.request("/setup/env", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				values: {
					ASTRA_DB_API_ENDPOINT: "https://x.apps.astra.datastax.com",
					ASTRA_DB_APPLICATION_TOKEN: "AstraCS:fake:token",
				},
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown> & {
			error?: { code?: string; message?: string };
		};
		expect(body.ok).toBe(true);
		expect(body.written).toEqual([
			"ASTRA_DB_API_ENDPOINT",
			"ASTRA_DB_APPLICATION_TOKEN",
		]);
		const path = join(dataDir, ".env");
		const contents = readFileSync(path, "utf8");
		expect(contents).toContain(
			'ASTRA_DB_API_ENDPOINT="https://x.apps.astra.datastax.com"',
		);
		expect(contents).toContain(
			'ASTRA_DB_APPLICATION_TOKEN="AstraCS:fake:token"',
		);
		// 0o600 — owner rw only.
		const mode = statSync(path).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	test("POST /setup/env rejects keys outside the allow-list", async () => {
		const { app } = makeSetupApp({ dataDir });
		const res = await app.request("/setup/env", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ values: { PATH: "/evil" } }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			error: { code: string; message: string };
		};
		expect(body.error.code).toBe("validation_error");
		expect(body.error.message).toContain("unknown key");
	});

	test("POST /setup/env requires bearer when auth.mode is not disabled", async () => {
		const { app } = makeSetupApp({
			dataDir,
			authMode: "apiKey",
		});
		const res = await app.request("/setup/env", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ values: { HUGGINGFACE_API_KEY: "hf_x" } }),
		});
		expect(res.status).toBe(401);
	});

	test("POST /setup/env refuses anonymous writes once setup is complete", async () => {
		const { app, store } = makeSetupApp({ dataDir });
		await store.createWorkspace({ name: "ws1", kind: "mock" });
		const res = await app.request("/setup/env", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ values: { HUGGINGFACE_API_KEY: "hf_x" } }),
		});
		expect(res.status).toBe(403);
	});

	test("POST /setup/env accepts the bootstrap token after setup completes", async () => {
		const token = "bootstrap-token-32-characters-min-ok";
		const { app, store } = makeSetupApp({
			dataDir,
			bootstrapToken: token,
		});
		await store.createWorkspace({ name: "ws1", kind: "mock" });
		const res = await app.request("/setup/env", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ values: { HUGGINGFACE_API_KEY: "hf_x" } }),
		});
		expect(res.status).toBe(200);
	});

	test("POST /setup/restart calls the registered hook", async () => {
		const trigger = vi.fn();
		const { app } = makeSetupApp({ dataDir, triggerRestart: trigger });
		const res = await app.request("/setup/restart", { method: "POST" });
		expect(res.status).toBe(202);
		// setImmediate defers — flush the event loop once.
		await new Promise((r) => setImmediate(r));
		expect(trigger).toHaveBeenCalledOnce();
	});
});
