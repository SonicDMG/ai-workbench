/**
 * Regenerate conformance fixtures from the canonical TypeScript runtime.
 *
 * For each scenario in `conformance/scenarios.json`:
 *   1. Create a fresh memory-backed workbench app.
 *   2. Replay the scenario's HTTP requests against `app.request(...)`.
 *   3. Normalize responses (UUIDs, timestamps, request IDs).
 *   4. Write `conformance/fixtures/<slug>.json`.
 *
 * Run via `npm run conformance:regenerate` whenever an intentional API
 * change lands. Commit the resulting fixture files alongside the change.
 * Every language runtime's conformance suite then diffs against the
 * new fixtures.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — mjs import without types; it's intentional.
import { runScenario } from "../../../conformance/runner.mjs";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// this file is at runtimes/typescript/scripts/... → repo root is 3 levels up
const REPO_ROOT = resolve(HERE, "../../..");
const SCENARIOS_PATH = resolve(REPO_ROOT, "conformance/scenarios.json");
const FIXTURES_DIR = resolve(REPO_ROOT, "conformance/fixtures");

interface Scenario {
	readonly slug: string;
	readonly description?: string;
	readonly steps: ReadonlyArray<{
		readonly method: string;
		readonly path: string;
		readonly body?: unknown;
	}>;
}

async function fetcherForFreshApp(): Promise<
	(
		method: string,
		path: string,
		body?: unknown,
	) => Promise<{
		status: number;
		body: unknown;
	}>
> {
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
	return async (method, path, body) => {
		const init: RequestInit = { method };
		if (body !== undefined) {
			init.body = JSON.stringify(body);
			init.headers = { "content-type": "application/json" };
		}
		const res = await app.request(path, init);
		const contentType = res.headers.get("content-type") ?? "";
		let parsedBody: unknown = null;
		if (contentType.includes("application/json")) {
			const text = await res.text();
			parsedBody = text ? JSON.parse(text) : null;
		} else {
			const text = await res.text();
			parsedBody = text || null;
		}
		return { status: res.status, body: parsedBody };
	};
}

async function main(): Promise<void> {
	const scenariosRaw = await readFile(SCENARIOS_PATH, "utf8");
	const scenarios = JSON.parse(scenariosRaw) as Scenario[];

	for (const scenario of scenarios) {
		const fetcher = await fetcherForFreshApp();
		const normalizedCaptures = await runScenario(scenario, fetcher);
		const fixturePath = resolve(FIXTURES_DIR, `${scenario.slug}.json`);
		const payload = {
			slug: scenario.slug,
			description: scenario.description ?? null,
			captures: normalizedCaptures,
		};
		await writeFile(
			fixturePath,
			`${JSON.stringify(payload, null, "\t")}\n`,
			"utf8",
		);
		// eslint-disable-next-line no-console
		console.log(`  wrote ${fixturePath}`);
	}
}

main().catch((err: unknown) => {
	// eslint-disable-next-line no-console
	console.error("conformance:regenerate failed:", err);
	process.exit(1);
});
