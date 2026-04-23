import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../src/app.js";
import { AuthResolver } from "../../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { buildUiAssets } from "../../src/ui/assets.js";

/**
 * End-to-end checks for the single-image path: runtime mounted with a
 * UI dist directory serves static assets, falls back to index.html for
 * SPA routes, and still surfaces the JSON API + docs untouched.
 */
describe("app with UI assets", () => {
	let tmp: string;
	let app: ReturnType<typeof createApp>;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "wb-ui-app-"));
		writeFileSync(
			join(tmp, "index.html"),
			'<!doctype html><html><body><div id="root"></div></body></html>',
		);
		writeFileSync(join(tmp, "favicon.svg"), "<svg/>");
		mkdirSync(join(tmp, "assets"));
		writeFileSync(join(tmp, "assets", "index.js"), "console.log(1)");

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
		app = createApp({
			store,
			drivers,
			secrets,
			auth,
			ui: buildUiAssets(tmp),
		});
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	test("GET / returns the SPA shell (shadows the operator banner)", async () => {
		const res = await app.request("/", {
			headers: { accept: "text/html" },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toContain("text/html");
		const body = await res.text();
		expect(body).toContain('<div id="root">');
	});

	test("GET /favicon.svg serves the file from disk", async () => {
		const res = await app.request("/favicon.svg");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("<svg/>");
	});

	test("GET /assets/index.js serves the file from disk", async () => {
		const res = await app.request("/assets/index.js");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("console.log(1)");
	});

	test("GET /api/v1/openapi.json still returns the JSON contract", async () => {
		const res = await app.request("/api/v1/openapi.json");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toContain("application/json");
		const body = (await res.json()) as { openapi: string };
		expect(body.openapi).toBe("3.1.0");
	});

	test("GET /healthz still returns the JSON probe", async () => {
		const res = await app.request("/healthz");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe("ok");
	});

	test("GET /workspaces (SPA route) falls back to index.html when Accept is HTML", async () => {
		const res = await app.request("/workspaces/some-uid", {
			headers: { accept: "text/html" },
		});
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('<div id="root">');
	});

	test("GET /api/v1/nope returns canonical JSON 404 even when UI is mounted", async () => {
		const res = await app.request("/api/v1/nope");
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("not_found");
	});

	test("GET /missing.js returns JSON 404 (asset-looking paths don't get SPA fallback)", async () => {
		const res = await app.request("/missing.js", {
			headers: { accept: "text/html" },
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("not_found");
	});

	test("GET /onboarding without HTML Accept returns canonical 404", async () => {
		// JSON clients don't get HTML surprises: no accept:text/html → 404.
		const res = await app.request("/onboarding", {
			headers: { accept: "application/json" },
		});
		expect(res.status).toBe(404);
	});
});

describe("app without UI assets", () => {
	test("GET / still returns the operator banner", async () => {
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
		const app = createApp({ store, drivers, secrets, auth });
		const res = await app.request("/");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { name: string };
		expect(body.name).toBe("ai-workbench");
	});
});
