import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `applyLogLevel` is tested by reloading the logger module under
 * different `process.env.LOG_LEVEL` states, since the env read
 * happens once at module load. Each test gets a fresh module via
 * `vi.resetModules()`.
 */

const ORIGINAL = process.env.LOG_LEVEL;

describe("applyLogLevel", () => {
	beforeEach(() => {
		vi.resetModules();
	});
	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.LOG_LEVEL;
		else process.env.LOG_LEVEL = ORIGINAL;
	});

	test("applies configured level when LOG_LEVEL env is unset", async () => {
		delete process.env.LOG_LEVEL;
		const { applyLogLevel, logger } = await import("../src/lib/logger.js");
		const result = applyLogLevel("debug");
		expect(result).toEqual({ level: "debug", source: "config" });
		expect(logger.level).toBe("debug");
	});

	test("LOG_LEVEL env overrides configured value", async () => {
		process.env.LOG_LEVEL = "warn";
		const { applyLogLevel, logger } = await import("../src/lib/logger.js");
		expect(logger.level).toBe("warn");
		const result = applyLogLevel("debug");
		expect(result).toEqual({ level: "warn", source: "env" });
		// logger.level must stay at the env value
		expect(logger.level).toBe("warn");
	});

	test("empty LOG_LEVEL env is treated as unset", async () => {
		process.env.LOG_LEVEL = "";
		const { applyLogLevel, logger } = await import("../src/lib/logger.js");
		const result = applyLogLevel("trace");
		expect(result).toEqual({ level: "trace", source: "config" });
		expect(logger.level).toBe("trace");
	});

	test("configured level accepts all schema-supported values", async () => {
		delete process.env.LOG_LEVEL;
		const { applyLogLevel, logger } = await import("../src/lib/logger.js");
		for (const level of ["trace", "debug", "info", "warn", "error"] as const) {
			const result = applyLogLevel(level);
			expect(result.level).toBe(level);
			expect(logger.level).toBe(level);
		}
	});
});
