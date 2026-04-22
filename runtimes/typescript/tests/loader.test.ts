import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolveConfigPath } from "../src/config/loader.js";

/**
 * `resolveConfigPath` walks a documented precedence chain that
 * includes filesystem checks. These tests drive the function with
 * explicit `argv` / `env` args so they don't depend on the real
 * process state, and exercise the filesystem branches by running
 * each case from a scoped temporary working directory.
 */
describe("resolveConfigPath", () => {
	let scratch: string;
	let originalCwd: string;

	beforeEach(() => {
		scratch = mkdtempSync(join(tmpdir(), "wb-cfg-"));
		originalCwd = process.cwd();
		process.chdir(scratch);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(scratch, { recursive: true, force: true });
	});

	test("prefers --config flag over everything else", () => {
		writeFileSync(join(scratch, "workbench.yaml"), "version: 1\n");
		expect(
			resolveConfigPath(["node", "root.ts", "--config", "/tmp/x.yaml"], {}),
		).toBe("/tmp/x.yaml");
	});

	test("falls through to WORKBENCH_CONFIG when no flag is set", () => {
		writeFileSync(join(scratch, "workbench.yaml"), "version: 1\n");
		expect(
			resolveConfigPath(["node", "root.ts"], {
				WORKBENCH_CONFIG: "/etc/alt/wb.yaml",
			}),
		).toBe("/etc/alt/wb.yaml");
	});

	test("falls through to ./workbench.yaml when present", () => {
		writeFileSync(join(scratch, "workbench.yaml"), "version: 1\n");
		expect(resolveConfigPath(["node", "root.ts"], {})).toBe("./workbench.yaml");
	});

	test("falls through to ./examples/workbench.yaml when present", () => {
		mkdirSync(join(scratch, "examples"));
		writeFileSync(join(scratch, "examples/workbench.yaml"), "version: 1\n");
		expect(resolveConfigPath(["node", "root.ts"], {})).toBe(
			"./examples/workbench.yaml",
		);
	});

	test("prefers ./workbench.yaml over ./examples/workbench.yaml", () => {
		writeFileSync(join(scratch, "workbench.yaml"), "version: 1\n");
		mkdirSync(join(scratch, "examples"));
		writeFileSync(join(scratch, "examples/workbench.yaml"), "version: 1\n");
		expect(resolveConfigPath(["node", "root.ts"], {})).toBe("./workbench.yaml");
	});

	test("returns the Docker default when nothing else matches", () => {
		// The scratch dir is empty — neither workbench.yaml nor
		// examples/workbench.yaml exists, no flag, no env var.
		expect(existsSync(join(scratch, "workbench.yaml"))).toBe(false);
		expect(resolveConfigPath(["node", "root.ts"], {})).toBe(
			"/etc/workbench/workbench.yaml",
		);
	});

	test("--config with no following value is ignored", () => {
		writeFileSync(join(scratch, "workbench.yaml"), "version: 1\n");
		expect(resolveConfigPath(["node", "root.ts", "--config"], {})).toBe(
			"./workbench.yaml",
		);
	});
});
