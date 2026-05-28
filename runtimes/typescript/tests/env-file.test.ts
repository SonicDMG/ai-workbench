import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadDotEnv } from "../src/config/env-file.js";

describe("loadDotEnv", () => {
	let root: string;
	let prevCwd: string;
	let prevExplicit: string | undefined;
	let prevDataDir: string | undefined;
	let prevManagedExplicit: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "wb-env-"));
		prevCwd = process.cwd();
		prevExplicit = process.env.WORKBENCH_ENV_FILE;
		prevDataDir = process.env.WORKBENCH_DATA_DIR;
		prevManagedExplicit = process.env.WORKBENCH_MANAGED_ENV_FILE;
		delete process.env.WORKBENCH_ENV_FILE;
		// Point the managed-env locator into the test dir so the
		// fallback (`./.workbench-data/.env`) doesn't trip on the
		// repo's actual managed file.
		process.env.WORKBENCH_MANAGED_ENV_FILE = join(
			root,
			"managed-absent",
			".env",
		);
		// Every test clears any env vars it sets via beforeEach state.
	});

	afterEach(() => {
		process.chdir(prevCwd);
		rmSync(root, { recursive: true, force: true });
		if (prevExplicit === undefined) delete process.env.WORKBENCH_ENV_FILE;
		else process.env.WORKBENCH_ENV_FILE = prevExplicit;
		if (prevDataDir === undefined) delete process.env.WORKBENCH_DATA_DIR;
		else process.env.WORKBENCH_DATA_DIR = prevDataDir;
		if (prevManagedExplicit === undefined)
			delete process.env.WORKBENCH_MANAGED_ENV_FILE;
		else process.env.WORKBENCH_MANAGED_ENV_FILE = prevManagedExplicit;
	});

	test("returns source: 'none' when no .env is found", () => {
		// Mark the dir as a repo root so the walk stops here.
		mkdirSync(join(root, ".git"));
		process.chdir(root);
		const result = loadDotEnv();
		expect(result).toEqual({
			path: null,
			source: "none",
			managedEnvPath: null,
		});
	});

	test("loads .env from the current working directory", () => {
		const key = "__WB_ENV_TEST_A";
		delete process.env[key];
		writeFileSync(join(root, ".env"), `${key}=from-env-file\n`);
		process.chdir(root);
		const result = loadDotEnv();
		try {
			expect(result.source).toBe("walked");
			expect(process.env[key]).toBe("from-env-file");
		} finally {
			delete process.env[key];
		}
	});

	test("walks up toward the repo root to find .env", () => {
		const key = "__WB_ENV_TEST_B";
		delete process.env[key];
		// Simulate a real repo: .env + .git at `root`, CWD two levels deeper.
		writeFileSync(join(root, ".env"), `${key}=walked\n`);
		mkdirSync(join(root, ".git"));
		const deep = join(root, "runtimes", "typescript");
		mkdirSync(deep, { recursive: true });
		process.chdir(deep);
		const result = loadDotEnv();
		try {
			expect(result.source).toBe("walked");
			// Compare the basename + immediate parent to sidestep macOS's
			// `/var/folders` ↔ `/private/var/folders` symlink surfacing
			// through `process.cwd()`.
			expect(result.path?.endsWith("/.env")).toBe(true);
			expect(process.env[key]).toBe("walked");
		} finally {
			delete process.env[key];
		}
	});

	test("does not cross the .git boundary downward when walking up", () => {
		// .git marks the repo root. A .env *above* it must NOT be picked up.
		const key = "__WB_ENV_TEST_C";
		delete process.env[key];
		const outer = mkdtempSync(join(tmpdir(), "wb-env-outer-"));
		try {
			writeFileSync(join(outer, ".env"), `${key}=outside\n`);
			const inner = join(outer, "repo");
			mkdirSync(inner);
			mkdirSync(join(inner, ".git"));
			process.chdir(inner);
			const result = loadDotEnv();
			expect(result.source).toBe("none");
			expect(process.env[key]).toBeUndefined();
		} finally {
			rmSync(outer, { recursive: true, force: true });
			delete process.env[key];
		}
	});

	test("explicit WORKBENCH_ENV_FILE overrides the walk", () => {
		const key = "__WB_ENV_TEST_D";
		delete process.env[key];
		const explicit = join(root, "custom.env");
		writeFileSync(explicit, `${key}=explicit\n`);
		// Put a different .env in CWD to prove the explicit path wins.
		writeFileSync(join(root, ".env"), `${key}=would-be-walked\n`);
		mkdirSync(join(root, ".git"));
		process.chdir(root);
		process.env.WORKBENCH_ENV_FILE = explicit;
		const result = loadDotEnv();
		try {
			expect(result.source).toBe("explicit");
			expect(process.env[key]).toBe("explicit");
		} finally {
			delete process.env[key];
		}
	});

	test("explicit WORKBENCH_ENV_FILE pointing at a missing file returns explicit-absent (setup wizard writes it on first run)", () => {
		const missing = join(root, "does-not-exist.env");
		process.env.WORKBENCH_ENV_FILE = missing;
		const result = loadDotEnv();
		expect(result.source).toBe("explicit-absent");
		expect(result.path).toBe(missing);
	});

	test("pre-existing process.env values win over .env entries", () => {
		const key = "__WB_ENV_TEST_E";
		process.env[key] = "from-shell";
		writeFileSync(join(root, ".env"), `${key}=from-file\n`);
		mkdirSync(join(root, ".git"));
		process.chdir(root);
		try {
			loadDotEnv();
			expect(process.env[key]).toBe("from-shell");
		} finally {
			delete process.env[key];
		}
	});

	test("also loads the managed env file written by /setup/env", () => {
		// This is the bug the user hit: the wizard / `/settings` page
		// wrote `.workbench-data/.env` with HUGGINGFACE_API_KEY, but
		// `loadDotEnv` only walked for a project `.env` — so on
		// respawn the new HF token never reached `process.env` and
		// `chat_disabled` persisted.
		const key = "__WB_ENV_TEST_MANAGED";
		delete process.env[key];
		const managed = join(root, "managed", ".env");
		mkdirSync(join(root, "managed"));
		writeFileSync(managed, `${key}=from-managed\n`);
		process.env.WORKBENCH_MANAGED_ENV_FILE = managed;
		mkdirSync(join(root, ".git"));
		process.chdir(root);
		try {
			const result = loadDotEnv();
			expect(result.managedEnvPath).toBe(managed);
			expect(process.env[key]).toBe("from-managed");
		} finally {
			delete process.env[key];
		}
	});

	test("primary source (walked .env) wins over managed-env for the same key", () => {
		// Operator-explicit walked .env should beat the wizard-written
		// managed file. Node's `loadEnvFile` is no-overwrite, and we
		// load primary first, so the walked value sticks.
		const key = "__WB_ENV_TEST_PRECEDENCE";
		delete process.env[key];
		writeFileSync(join(root, ".env"), `${key}=walked-wins\n`);
		const managed = join(root, "managed", ".env");
		mkdirSync(join(root, "managed"));
		writeFileSync(managed, `${key}=from-managed\n`);
		process.env.WORKBENCH_MANAGED_ENV_FILE = managed;
		mkdirSync(join(root, ".git"));
		process.chdir(root);
		try {
			const result = loadDotEnv();
			expect(result.source).toBe("walked");
			expect(result.managedEnvPath).toBe(managed);
			expect(process.env[key]).toBe("walked-wins");
		} finally {
			delete process.env[key];
		}
	});

	test("managed-env file may be absent (fresh install before wizard ran)", () => {
		mkdirSync(join(root, ".git"));
		process.chdir(root);
		// Pointed at a managed path that doesn't exist — must not throw.
		const result = loadDotEnv();
		expect(result.managedEnvPath).toBeNull();
		expect(result.source).toBe("none");
	});
});
