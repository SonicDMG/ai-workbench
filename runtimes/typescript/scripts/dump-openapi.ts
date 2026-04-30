/**
 * Dump the runtime's OpenAPI document to a static file without
 * booting the HTTP server. Used by the web app's `gen:types` step to
 * feed `openapi-typescript`.
 *
 * Usage:
 *   tsx scripts/dump-openapi.ts <output-path>
 *
 * Default output is `dist/openapi.json` relative to the runtime
 * package root, so the file lands inside the build artifact.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";

async function main(): Promise<void> {
	const outPath = resolve(process.argv[2] ?? "dist/openapi.json");

	// The OpenAPI doc is generated from the route schemas alone — the
	// concrete store / driver / auth instances are never consulted, so
	// minimal in-memory stand-ins are enough.
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
	const embedders = {
		forConfig() {
			throw new Error("not used during OpenAPI dump");
		},
	} as unknown as Parameters<typeof createApp>[0]["embedders"];

	const app = createApp({ store, drivers, secrets, auth, embedders });
	// Reuse the same route the runtime exposes at `/api/v1/openapi.json`
	// so the dumped contract is identical to what live clients fetch.
	const res = await app.request("/api/v1/openapi.json");
	if (!res.ok) {
		throw new Error(`openapi route returned ${res.status}`);
	}
	const document = await res.json();

	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
	process.stdout.write(`wrote ${outPath}\n`);
}

main().catch((err: unknown) => {
	process.stderr.write(`dump-openapi failed: ${String(err)}\n`);
	process.exit(1);
});
