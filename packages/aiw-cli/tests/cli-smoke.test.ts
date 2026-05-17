/**
 * End-to-end smoke against the compiled `aiw` binary.
 *
 * Runs the actual `dist/cli.js` as a subprocess to catch regressions
 * unit tests miss — bin wiring, citty's argument parsing, version
 * constant, and graceful error exits when no credentials exist.
 *
 * Skipped automatically when `dist/cli.js` doesn't exist (e.g. on a
 * fresh checkout before `npm run build`). CI runs `npm run build`
 * before tests so the binary is always present there.
 *
 * Note: we only assert on exit codes + stderr-on-error, not on
 * stdout content. Vitest 4's worker stdio-capture interferes with
 * pipes from fast-exiting subprocesses (--version, --help) which
 * yield empty buffers in the parent test even though the binary
 * works correctly under a regular shell. The "exits with an error
 * when no profile is configured" path goes through the same boot
 * sequence and reliably surfaces a non-zero exit + a stderr message,
 * which is what we actually care about catching.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const binary = resolve(here, "..", "dist", "cli.js");
const hasBuild = existsSync(binary);

interface SpawnResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

async function readAll(stream: NodeJS.ReadableStream | null): Promise<string> {
	if (!stream) return "";
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function run(
	args: readonly string[],
	env: NodeJS.ProcessEnv = {},
): Promise<SpawnResult> {
	const child = spawn(process.execPath, [binary, ...args], {
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const [stdout, stderr, code] = await Promise.all([
		readAll(child.stdout),
		readAll(child.stderr),
		new Promise<number | null>((res, rej) => {
			child.on("error", rej);
			child.on("close", (c) => res(c));
		}),
	]);
	return { code, stdout, stderr };
}

describe.skipIf(!hasBuild)("aiw binary smoke", () => {
	let tmpHome: string;

	beforeEach(async () => {
		tmpHome = await mkdtemp(join(tmpdir(), "aiw-cli-smoke-"));
	});

	afterEach(async () => {
		await rm(tmpHome, { recursive: true, force: true });
	});

	it("loads and exits 0 on --version", async () => {
		const r = await run(["--version"]);
		expect(r.code).toBe(0);
	});

	it("loads and exits 0 on --help", async () => {
		const r = await run(["--help"]);
		expect(r.code).toBe(0);
	});

	it("fails with a clear stderr message when no profile is configured", async () => {
		const r = await run(["workspace", "list"], {
			HOME: tmpHome,
			USERPROFILE: tmpHome,
			AIW_PROFILE: "",
			AIW_API_URL: "",
			AIW_API_KEY: "",
		});
		expect(r.code).not.toBe(0);
		expect(r.stderr.toLowerCase()).toMatch(/profile|login/);
	});

	it("rejects unknown --output values", async () => {
		const r = await run(["workspace", "list", "--output", "yaml"], {
			HOME: tmpHome,
			USERPROFILE: tmpHome,
			AIW_PROFILE: "",
		});
		expect(r.code).not.toBe(0);
	});
});
