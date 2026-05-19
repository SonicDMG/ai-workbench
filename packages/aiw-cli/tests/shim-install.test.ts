/**
 * End-to-end tests for `aiw shim install`.
 *
 * All disk effects are sandboxed under a per-test temporary `$HOME`,
 * and the real-astra-discovery is steered by overriding `$PATH` to a
 * scratch dir containing (or not containing) a stub `astra`. We never
 * touch `/opt/homebrew/bin` or `/usr/local/bin` from the test runner.
 */
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const binary = resolve(here, "..", "dist", "cli.js");
const shimSource = resolve(here, "..", "scripts", "astra-shim.sh");
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
	env: NodeJS.ProcessEnv,
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

describe.skipIf(!hasBuild)("aiw shim install", () => {
	let home: string;
	let pathDir: string;
	let env: NodeJS.ProcessEnv;

	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), "aiw-shim-install-"));
		pathDir = await mkdtemp(join(tmpdir(), "aiw-shim-install-path-"));
		// Keep /bin and /usr/bin so child_process can resolve `bash` for
		// the embedded `command -v -a astra` lookup inside the install
		// command's findRealAstra(). Put pathDir first so a stub astra
		// dropped there is what we discover.
		env = {
			HOME: home,
			USERPROFILE: home,
			PATH: `${pathDir}:/bin:/usr/bin`,
			AIW_PROFILE: "",
			AIW_API_URL: "",
			AIW_API_KEY: "",
			// Suppress findRealAstra's homebrew/usr-local fallback so the
			// host system's actual `astra` install can't leak into the
			// sandboxed PATH walk.
			AIW_SHIM_NO_KNOWN_LOCATIONS: "1",
		};
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
		await rm(pathDir, { recursive: true, force: true });
	});

	function seedStubAstra() {
		const stub = join(pathDir, "astra");
		writeFileSync(stub, "#!/bin/bash\necho stub\n", { mode: 0o755 });
		return stub;
	}

	it("creates a symlink at ~/.aiw/bin/astra by default", async () => {
		const r = await run(["shim", "install", "--output", "json"], env);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.target).toBe(join(home, ".aiw", "bin", "astra"));
		expect(out.mode).toBe("fresh");
		expect(out.applied).toBe(true);
		expect(out.backup).toBeNull();
		const link = lstatSync(out.target);
		expect(link.isSymbolicLink()).toBe(true);
		expect(readlinkSync(out.target)).toBe(shimSource);
	});

	it("--print leaves disk untouched and reports the would-be plan", async () => {
		const r = await run(
			["shim", "install", "--print", "--output", "json"],
			env,
		);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.applied).toBe(false);
		expect(out.dryRun).toBe(true);
		expect(existsSync(out.target)).toBe(false);
	});

	it("is idempotent — running twice flips mode to already-shim with no backup", async () => {
		const first = JSON.parse(
			(await run(["shim", "install", "--output", "json"], env)).stdout,
		);
		expect(first.mode).toBe("fresh");

		const second = JSON.parse(
			(await run(["shim", "install", "--output", "json"], env)).stdout,
		);
		expect(second.mode).toBe("already-shim");
		expect(second.applied).toBe(false);
		expect(second.backup).toBeNull();
		expect(lstatSync(second.target).isSymbolicLink()).toBe(true);
	});

	it("backs up a non-shim file at the target before symlinking", async () => {
		// Pre-seed a real file at the install location.
		const targetDir = join(home, ".aiw", "bin");
		writeFileSync(
			join(home, "throwaway"), // placeholder to ensure tmp dir is writable
			"x",
		);
		// Create the dir + file the shim should displace.
		const { mkdirSync } = await import("node:fs");
		mkdirSync(targetDir, { recursive: true });
		const target = join(targetDir, "astra");
		writeFileSync(target, "real-astra-bytes", { mode: 0o755 });

		const r = await run(["shim", "install", "--output", "json"], env);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.mode).toBe("back-up-existing");
		expect(out.backup).toMatch(/\.aiw-bak-/);
		expect(existsSync(out.backup)).toBe(true);
		expect(lstatSync(out.target).isSymbolicLink()).toBe(true);
		expect(readlinkSync(out.target)).toBe(shimSource);
	});

	it("--replace targets the discovered real astra and backs up to .real", async () => {
		const stub = seedStubAstra();
		const r = await run(
			["shim", "install", "--replace", "--output", "json"],
			env,
		);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.mode).toBe("replace-real");
		expect(out.target).toBe(stub);
		expect(out.backup).toBe(`${stub}.real`);
		expect(existsSync(out.backup)).toBe(true);
		expect(lstatSync(out.target).isSymbolicLink()).toBe(true);
		expect(readlinkSync(out.target)).toBe(shimSource);
	});

	it("--replace errors clearly when no real astra is discoverable", async () => {
		const r = await run(["shim", "install", "--replace"], {
			...env,
			// No stub astra, and PATH stripped to coreutils only.
			PATH: "/bin:/usr/bin",
		});
		expect(r.code).not.toBe(0);
		expect(r.stderr.toLowerCase()).toContain("--replace");
	});

	it("prints a PATH advisory when the install dir is not on PATH", async () => {
		const r = await run(["shim", "install"], env);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("Add ");
		expect(r.stdout).toContain(".aiw/bin");
		expect(r.stdout).toContain("PATH");
	});

	it("suppresses the PATH advisory when the install dir already leads PATH", async () => {
		// Put ~/.aiw/bin at the head of PATH so the advisory shouldn't fire.
		const aiwBin = join(home, ".aiw", "bin");
		const r = await run(["shim", "install"], {
			...env,
			PATH: `${aiwBin}:${env.PATH}`,
		});
		expect(r.code).toBe(0);
		expect(r.stdout).not.toContain("Add ");
	});

	it("reports the real astra path so the user can export ASTRA_REAL_BIN", async () => {
		const stub = seedStubAstra();
		const r = await run(["shim", "install"], env);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain(stub);
		expect(r.stdout).toContain("ASTRA_REAL_BIN");
	});

	it("recovers the real astra from a `<shim>.real` companion on re-runs", async () => {
		// Simulate the post-`--replace` state: the only `astra` on PATH
		// is a symlink to the shim, and the original binary is parked
		// alongside as `astra.real`.
		const onPath = join(pathDir, "astra");
		writeFileSync(`${onPath}.real`, "#!/bin/bash\necho real\n", {
			mode: 0o755,
		});
		const { symlinkSync: link } = await import("node:fs");
		link(shimSource, onPath);

		const r = await run(
			["shim", "install", "--print", "--output", "json"],
			env,
		);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.realAstra).toBe(`${onPath}.real`);
	});
});
