import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadDotEnv } from "../src/config/env-file.js";

describe("loadDotEnv", () => {
	let root: string;
	let prevCwd: string;
	let prevExplicit: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "wb-env-"));
		prevCwd = process.cwd();
		prevExplicit = process.env.WORKBENCH_ENV_FILE;
		delete process.env.WORKBENCH_ENV_FILE;
		// Every test clears any env vars it sets via beforeEach state.
	});

	afterEach(() => {
		process.chdir(prevCwd);
		rmSync(root, { recursive: true, force: true });
		if (prevExplicit === undefined) delete process.env.WORKBENCH_ENV_FILE;
		else process.env.WORKBENCH_ENV_FILE = prevExplicit;
	});

	test("returns source: 'none' when no .env is found", () => {
		// Mark the dir as a repo root so the walk stops here.
		mkdirSync(join(root, ".git"));
		process.chdir(root);
		const result = loadDotEnv();
		expect(result).toEqual({ path: null, source: "none" });
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

	test("explicit WORKBENCH_ENV_FILE pointing at a missing file throws", () => {
		process.env.WORKBENCH_ENV_FILE = join(root, "does-not-exist.env");
		expect(() => loadDotEnv()).toThrow();
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
});
