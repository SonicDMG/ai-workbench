/**
 * Generic scenario runner — driver for conformance tests and fixture
 * generation. Language-agnostic in spirit (every runtime has its own
 * port, see clients/python-runtime/tests/); the JS version here is
 * reused by the TS runtime's tests and by
 * scripts/conformance-regenerate.ts.
 *
 * Input:
 *   - A scenario from clients/conformance/scenarios.json.
 *   - A `fetcher(method, path, body?) → { status, body }` function
 *     that knows how to hit the green box under test. The TS harness
 *     wraps `app.request(...)`; the Python harness wraps an
 *     httpx.AsyncClient.
 *
 * Output:
 *   An array of `{step, request, response}` objects. Each response body
 *   is normalized: real UUIDs → {{UUID_N}}, ISO timestamps → {{TS_N}},
 *   by first-appearance order.
 *
 * Template syntax in scenario bodies/paths:
 *   $N.field  →  the value of `field` in step N's raw (pre-normalized)
 *                response body. Supports dot-path like `$1.uid`.
 *   (Only the raw value is substituted into the outgoing request; the
 *    fixture captures the normalized placeholder in the path.)
 */

import { normalize } from "./normalize.mjs";

/**
 * Resolve `$N.field.subfield` against the prior captured raw responses.
 */
function resolveValue(template, rawResponses) {
	if (typeof template !== "string") return template;
	const m = /^\$(\d+)\.(.+)$/.exec(template);
	if (!m) return template;
	const stepNum = Number(m[1]);
	const path = m[2].split(".");
	let value = rawResponses[stepNum - 1];
	for (const seg of path) {
		if (value == null) return undefined;
		value = value[seg];
	}
	return value;
}

function resolveStructure(v, rawResponses) {
	if (typeof v === "string" && v.startsWith("$")) {
		return resolveValue(v, rawResponses);
	}
	if (Array.isArray(v)) return v.map((x) => resolveStructure(x, rawResponses));
	if (v && typeof v === "object") {
		const out = {};
		for (const [k, val] of Object.entries(v)) {
			out[k] = resolveStructure(val, rawResponses);
		}
		return out;
	}
	return v;
}

/** Resolve `$N.field` references in a path string. */
function resolvePath(path, rawResponses) {
	return path.replace(/\$(\d+)\.([A-Za-z0-9_.]+)/g, (_, n, field) =>
		String(resolveValue(`$${n}.${field}`, rawResponses)),
	);
}

/**
 * Execute a scenario by calling `fetcher` for each step.
 *
 * @param {object} scenario   One entry from scenarios.json.
 * @param {(method: string, path: string, body?: unknown) => Promise<{status: number, body: unknown}>} fetcher
 * @returns {Promise<Array<{step: number, request: {method: string, path: string, body: unknown}, response: {status: number, body: unknown}}>>}
 *          Normalized capture ready to write as a fixture.
 */
export async function runScenario(scenario, fetcher) {
	const rawResponses = [];
	const rawCaptures = [];

	for (let i = 0; i < scenario.steps.length; i++) {
		const step = scenario.steps[i];
		const path = resolvePath(step.path, rawResponses);
		const body =
			step.body === undefined
				? undefined
				: resolveStructure(step.body, rawResponses);

		const { status, body: respBody } = await fetcher(step.method, path, body);

		rawResponses.push(respBody);
		rawCaptures.push({
			step: i + 1,
			request: { method: step.method, path, body: body ?? null },
			response: { status, body: respBody ?? null },
		});
	}

	return normalize(rawCaptures);
}
