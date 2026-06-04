#!/usr/bin/env node
/**
 * MCP-trust scan for CI (`npm run security:mcp`) and re-pin
 * (`npm run security:mcp -- --pin`).
 *
 * "package-lock.json for MCP trust": pins every tool/prompt/resource a
 * server advertises — name + description + input-schema hash — into a
 * committed `toolprint.lock`, then fails when any of them drift (a
 * silent tool "rug-pull" is the classic prompt-injection vector). Runs
 * the upstream `toolprint` CLI (https://github.com/jestatsio/toolprint),
 * which only ever calls `tools/list` — it never executes a tool.
 *
 * Two targets, one lockfile:
 *   1. OUR OWN MCP server (`src/mcp/server.ts`). We boot the runtime
 *      hermetically (memory control plane + one seeded mock workspace +
 *      the default open-auth posture — see
 *      `examples/workbench.toolprint-ci.yaml`) so the scan can list the
 *      MCP surface with no Astra, secrets, LLM, or auth, then tear it
 *      down. This pins the contract we hand to external agents and
 *      fails CI if a code change alters a tool's description or schema.
 *   2. The project's trusted external MCP servers (`.toolprint/mcp.json`).
 *      Catches an upstream rug-pull in the dev tooling we depend on.
 *
 * Re-pin (and commit `toolprint.lock`) whenever you intentionally change
 * either surface. See `docs/mcp-trust.md`.
 *
 * The own-server scan runs against the hermetic open-auth instance
 * because the pinned tool *surface* (names / descriptions / schemas) is
 * identical with or without auth — auth gates access, not definitions —
 * and it keeps the boot dependency-free. toolprint 0.1.1 added
 * `--header` / `--bearer` (and `TOOLPRINT_BEARER`), so an authenticated
 * *remote* target can be scanned by passing a token; a throwaway
 * localhost instance doesn't need it.
 */

import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Pinned so a surprise upstream release can't silently change scan
// semantics; bump deliberately alongside a re-pin.
const TOOLPRINT = "toolprint@0.1.1";

const PORT = 8099;
const WORKSPACE_UID = "11111111-1111-4111-8111-111111111111";
const OWN_MCP_URL = `http://localhost:${PORT}/api/v1/workspaces/${WORKSPACE_UID}/mcp`;
const CI_CONFIG = resolve(
	REPO_ROOT,
	"runtimes/typescript/examples/workbench.toolprint-ci.yaml",
);
const TSX = resolve(REPO_ROOT, "runtimes/typescript/node_modules/.bin/tsx");
const RUNTIME_ENTRY = resolve(REPO_ROOT, "runtimes/typescript/src/root.ts");

const LOCKFILE = "toolprint.lock";
const DEV_CONFIG = ".toolprint/mcp.json";

const pin = process.argv.includes("--pin");
const verb = pin ? "pin" : "scan";
const READY_TIMEOUT_MS = 45_000;

// As of toolprint 0.1.1 (jestatsio/toolprint#13) a rug-pull — a pinned
// definition changing — is classified `high`, so the default
// `--fail-on high` already fails the scan on drift. No override needed.

/** Poll until the runtime accepts TCP connections (any HTTP reply = up). */
async function waitForServer() {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	const probe = `http://localhost:${PORT}/api/v1/workspaces`;
	while (Date.now() < deadline) {
		try {
			await fetch(probe, { signal: AbortSignal.timeout(2_000) });
			return; // any response means it's listening
		} catch {
			await new Promise((r) => setTimeout(r, 400));
		}
	}
	throw new Error(
		`runtime did not come up on :${PORT} within ${READY_TIMEOUT_MS}ms`,
	);
}

/** Run one toolprint invocation against the shared lockfile (inherits stdio). */
function toolprint(targetArgs, label) {
	console.log(`\n── toolprint ${verb}: ${label} ──`);
	const res = spawnSync(
		"npx",
		[
			"-y",
			TOOLPRINT,
			verb,
			...targetArgs,
			"--lockfile",
			LOCKFILE,
			"--timeout",
			"30000",
			"--no-telemetry",
		],
		{ cwd: REPO_ROOT, stdio: "inherit", env: process.env },
	);
	if (res.error) throw res.error;
	return res.status ?? 1;
}

async function main() {
	const server = spawn(TSX, [RUNTIME_ENTRY], {
		cwd: REPO_ROOT,
		env: { ...process.env, WORKBENCH_CONFIG: CI_CONFIG },
		stdio: ["ignore", "ignore", "inherit"],
	});
	server.on("error", (err) => {
		console.error("failed to spawn runtime:", err);
		process.exit(1);
	});

	let exitCode = 0;
	try {
		await waitForServer();
		// Two targets share one lockfile; scan validates only the target it
		// is handed, so other locked servers are left untouched.
		const own = toolprint([OWN_MCP_URL], "our MCP server (src/mcp/server.ts)");
		const dev = toolprint(
			["--config", DEV_CONFIG],
			`trusted external servers (${DEV_CONFIG})`,
		);
		exitCode = own || dev;
	} catch (err) {
		console.error(`\n${err instanceof Error ? err.message : err}`);
		exitCode = 1;
	} finally {
		server.kill("SIGTERM");
		const killed = await Promise.race([
			new Promise((r) => server.once("exit", () => r(true))),
			new Promise((r) => setTimeout(() => r(false), 5_000)),
		]);
		if (!killed) server.kill("SIGKILL");
	}

	if (exitCode === 0) {
		console.log(
			pin
				? "\n✅ Pinned. Review the toolprint.lock diff and commit it."
				: "\n✅ MCP trust check passed — no drift.",
		);
	} else {
		console.error(
			"\n❌ MCP trust check failed. If the change was intentional, re-pin: npm run security:mcp -- --pin",
		);
	}
	process.exit(exitCode);
}

main();
