/**
 * Behavioural tests for `scripts/astra-shim.sh`.
 *
 * We invoke the shim in a subprocess with `$ASTRA_REAL_BIN` and
 * `$AIW_BIN` pointed at tiny fake executables that just echo their
 * argv. The routing matrix we care about:
 *
 *   - `db workbench …`  →  aiw
 *   - `db ingest …`     →  aiw
 *   - `db <anything else> …`  →  real astra
 *   - any other top-level command, or no args  →  real astra
 *   - missing real astra exits non-zero with a clear hint
 *   - missing aiw (when routing) exits non-zero with a clear hint
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const shim = resolve(here, "..", "scripts", "astra-shim.sh");

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

// Absolute path so the spawn doesn't try to resolve `bash` against the
// per-test stripped-down PATH we pass via env.
const BASH = "/bin/bash";

async function runShim(
	args: readonly string[],
	env: NodeJS.ProcessEnv,
): Promise<SpawnResult> {
	const child = spawn(BASH, [shim, ...args], {
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

// Hard-coded /bin/bash shebang so the fakes execute even when the
// test strips PATH down to its own working directory.
async function makeFake(dir: string, name: string, marker: string) {
	const path = join(dir, name);
	await writeFile(path, `#!/bin/bash\necho "${marker} argc=$# args:$*"\n`, {
		mode: 0o755,
	});
	return path;
}

describe("astra-shim.sh", () => {
	let workDir: string;
	let realAstra: string;
	let aiw: string;
	let env: NodeJS.ProcessEnv;

	beforeEach(async () => {
		workDir = await mkdtemp(join(tmpdir(), "aiw-shim-"));
		realAstra = await makeFake(workDir, "fake-astra", "FAKE_ASTRA");
		aiw = await makeFake(workDir, "fake-aiw", "FAKE_AIW");
		// Need /bin:/usr/bin on PATH so the shim's coreutils calls
		// (dirname, basename, readlink) resolve. The workDir comes first
		// for any deliberate PATH-only routing case; the shim's lookup
		// of "real astra" still skips itself and prefers $ASTRA_REAL_BIN.
		env = {
			ASTRA_REAL_BIN: realAstra,
			AIW_BIN: aiw,
			PATH: `${workDir}:/bin:/usr/bin`,
		};
	});

	afterEach(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	it("routes `db workbench <db>` to aiw", async () => {
		const r = await runShim(["db", "workbench", "my_db"], env);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("FAKE_AIW");
		expect(r.stdout).toContain("db workbench my_db");
		expect(r.stdout).not.toContain("FAKE_ASTRA");
	});

	it("routes `db ingest <db> --workspace ws --kb kb --file f` to aiw", async () => {
		const r = await runShim(
			[
				"db",
				"ingest",
				"my_db",
				"--workspace",
				"ws",
				"--kb",
				"kb",
				"--file",
				"foo.pdf",
			],
			env,
		);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("FAKE_AIW");
		expect(r.stdout).toContain(
			"db ingest my_db --workspace ws --kb kb --file foo.pdf",
		);
	});

	it("routes `db ingest` with no positional db", async () => {
		const r = await runShim(
			["db", "ingest", "--workspace", "ws", "--kb", "kb", "--file", "x"],
			env,
		);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("FAKE_AIW");
		expect(r.stdout).toContain("db ingest --workspace ws --kb kb --file x");
	});

	it("passes `db list` through to the real astra", async () => {
		const r = await runShim(["db", "list"], env);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("FAKE_ASTRA");
		expect(r.stdout).toContain("db list");
		expect(r.stdout).not.toContain("FAKE_AIW");
	});

	it("passes `db cqlsh start mydb` through to the real astra", async () => {
		const r = await runShim(["db", "cqlsh", "start", "mydb"], env);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("FAKE_ASTRA");
		expect(r.stdout).toContain("db cqlsh start mydb");
	});

	it("passes top-level commands through to the real astra", async () => {
		const r = await runShim(["org", "info"], env);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("FAKE_ASTRA");
		expect(r.stdout).toContain("org info");
	});

	it("passes bare invocation through to the real astra", async () => {
		const r = await runShim([], env);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("FAKE_ASTRA");
		expect(r.stdout).toContain("argc=0");
	});

	it("forwards the real astra's non-zero exit code", async () => {
		await writeFile(realAstra, "#!/bin/bash\necho >&2 'boom'\nexit 42\n", {
			mode: 0o755,
		});
		const r = await runShim(["db", "list"], env);
		expect(r.code).toBe(42);
		expect(r.stderr).toContain("boom");
	});

	it("forwards aiw's non-zero exit code when routing", async () => {
		await writeFile(aiw, "#!/bin/bash\nexit 7\n", { mode: 0o755 });
		const r = await runShim(["db", "workbench", "x"], env);
		expect(r.code).toBe(7);
	});

	it("exits with a clear message when no real astra is discoverable", async () => {
		const r = await runShim(["db", "list"], {
			...env,
			ASTRA_REAL_BIN: "",
			PATH: "",
		});
		expect(r.code).not.toBe(0);
		expect(r.stderr.toLowerCase()).toContain("astra");
	});

	it("refuses to recurse when $ASTRA_REAL_BIN points back at the shim", async () => {
		// Simulate the post-`--replace`-gone-wrong state: the real-bin
		// override is itself a symlink to the shim. Without the guard
		// this exec's into the shim forever.
		const loop = join(workDir, "loop-astra");
		const { symlinkSync: link } = await import("node:fs");
		link(shim, loop);
		const r = await runShim(["db", "list"], {
			...env,
			ASTRA_REAL_BIN: loop,
		});
		expect(r.code).toBe(127);
		expect(r.stderr.toLowerCase()).toContain("recursion");
	});

	it("exits with a clear message when aiw cannot be found for routing", async () => {
		const r = await runShim(["db", "workbench", "x"], {
			...env,
			AIW_BIN: "",
			PATH: workDir, // still has fake-astra but no aiw
		});
		expect(r.code).toBe(127);
		expect(r.stderr.toLowerCase()).toContain("aiw");
	});
});
