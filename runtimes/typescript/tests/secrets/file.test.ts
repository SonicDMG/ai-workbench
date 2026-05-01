/**
 * Defense-in-depth tests for `FileSecretProvider`. The operator owns
 * `workbench.yaml`, but a `file:../../../etc/passwd` or
 * `file:/proc/self/environ` misconfig should fail loudly before ever
 * reading the filesystem.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertSafeSecretPath,
	FileSecretProvider,
	FileSecretRefError,
} from "../../src/secrets/file.js";

describe("assertSafeSecretPath", () => {
	it("accepts a plain absolute path", () => {
		expect(() =>
			assertSafeSecretPath("/etc/workbench/secrets/token"),
		).not.toThrow();
	});

	it("rejects an empty path", () => {
		expect(() => assertSafeSecretPath("")).toThrow(FileSecretRefError);
	});

	it("rejects relative paths", () => {
		expect(() => assertSafeSecretPath("etc/workbench/token")).toThrow(
			/must be absolute/,
		);
	});

	it("rejects '..' traversal even when it would normalize to an absolute path", () => {
		expect(() => assertSafeSecretPath("/../etc/passwd")).toThrow(
			/may not contain '\.\.'/,
		);
		expect(() => assertSafeSecretPath("/etc/../etc/passwd")).toThrow(
			/may not contain '\.\.'/,
		);
		expect(() => assertSafeSecretPath("../../etc/passwd")).toThrow();
	});

	it("rejects system pseudo-filesystems", () => {
		expect(() => assertSafeSecretPath("/proc/self/environ")).toThrow(
			/\/proc, \/sys, or \/dev/,
		);
		expect(() => assertSafeSecretPath("/sys/class/net")).toThrow();
		expect(() => assertSafeSecretPath("/dev/null")).toThrow();
	});

	it("does not reject paths that merely contain 'proc' or 'sys' as substrings", () => {
		expect(() => assertSafeSecretPath("/srv/processed/token")).not.toThrow();
		expect(() => assertSafeSecretPath("/var/lib/system/token")).not.toThrow();
	});
});

describe("FileSecretProvider", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "wb-secrets-test-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("reads the file and trims trailing whitespace", async () => {
		const path = join(dir, "token");
		await writeFile(path, "AstraCS:abcdef\n");
		const provider = new FileSecretProvider();
		expect(await provider.resolve(path)).toBe("AstraCS:abcdef");
	});

	it("throws FileSecretRefError without touching the filesystem on a bad ref", async () => {
		const provider = new FileSecretProvider();
		await expect(provider.resolve("/proc/self/environ")).rejects.toThrow(
			FileSecretRefError,
		);
		await expect(provider.resolve("../../etc/passwd")).rejects.toThrow(
			FileSecretRefError,
		);
	});
});
