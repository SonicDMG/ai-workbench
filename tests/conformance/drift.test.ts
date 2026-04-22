/**
 * Conformance drift guard for the canonical TypeScript runtime.
 *
 * Runs every scenario in `clients/conformance/scenarios.json` against
 * a fresh memory-backed app and diffs the normalized responses against
 * the committed fixtures. If this test fails, either:
 *
 *   - The TS runtime regressed (fix the runtime), or
 *   - The change is intentional (run `npm run conformance:regenerate`
 *     and commit the updated fixtures alongside the change — plus
 *     updates to every other language runtime in the same PR).
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// @ts-expect-error — pure JS module
import { runScenario } from "../../clients/conformance/runner.mjs";
import { createApp } from "../../src/app.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFORMANCE_ROOT = resolve(HERE, "../../clients/conformance");

interface Scenario {
	readonly slug: string;
	readonly description?: string;
	readonly steps: readonly unknown[];
}

async function loadScenarios(): Promise<Scenario[]> {
	const raw = await readFile(
		resolve(CONFORMANCE_ROOT, "scenarios.json"),
		"utf8",
	);
	return JSON.parse(raw) as Scenario[];
}

async function loadFixture(slug: string): Promise<unknown> {
	const raw = await readFile(
		resolve(CONFORMANCE_ROOT, "fixtures", `${slug}.json`),
		"utf8",
	);
	return JSON.parse(raw);
}

function freshFetcher() {
	const store = new MemoryControlPlaneStore();
	const app = createApp({ store });
	return async (method: string, path: string, body?: unknown) => {
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

describe("conformance drift guard", async () => {
	const scenarios = await loadScenarios();

	test("every scenario has a fixture", async () => {
		const files = await readdir(resolve(CONFORMANCE_ROOT, "fixtures"));
		const slugs = files
			.filter((f) => f.endsWith(".json"))
			.map((f) => f.replace(/\.json$/, ""))
			.sort();
		const expected = scenarios.map((s) => s.slug).sort();
		expect(slugs).toEqual(expected);
	});

	for (const scenario of scenarios) {
		test(`scenario '${scenario.slug}' matches its fixture`, async () => {
			const captures = await runScenario(scenario, freshFetcher());
			const fixture = (await loadFixture(scenario.slug)) as {
				slug: string;
				captures: unknown[];
			};
			expect(fixture.slug).toBe(scenario.slug);
			expect(captures).toEqual(fixture.captures);
		});
	}
});
