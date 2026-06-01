import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Defense-in-depth: the runtime logger must scrub credentials before
 * serialization so a stray `logger.x({ ...secret... })` cannot leak a
 * token to the log sink. These tests reload the logger module under
 * `NODE_ENV=production` (which skips the pino-pretty worker transport so
 * pino writes JSON synchronously to stdout) and capture the emitted line
 * to assert each redaction path.
 */

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_LOG_LEVEL = process.env.LOG_LEVEL;

interface LoadedLogger {
	logger: import("../src/lib/logger.js").Logger;
	lines: string[];
	restore: () => void;
}

async function loadLoggerCapturingStdout(): Promise<LoadedLogger> {
	vi.resetModules();
	process.env.NODE_ENV = "production";
	process.env.LOG_LEVEL = "info";
	const lines: string[] = [];
	const spy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: unknown): boolean => {
			lines.push(typeof chunk === "string" ? chunk : String(chunk));
			return true;
		});
	const mod = await import("../src/lib/logger.js");
	return {
		logger: mod.logger,
		lines,
		restore: () => spy.mockRestore(),
	};
}

function lastRecord(lines: string[]): Record<string, unknown> {
	const line = lines.at(-1);
	if (!line) throw new Error("expected at least one log line");
	return JSON.parse(line) as Record<string, unknown>;
}

describe("logger credential redaction", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
		if (ORIGINAL_LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
		else process.env.LOG_LEVEL = ORIGINAL_LOG_LEVEL;
		vi.restoreAllMocks();
	});

	test("redacts an authorization header logged under `headers`", async () => {
		const { logger, lines, restore } = await loadLoggerCapturingStdout();
		logger.info(
			{ headers: { authorization: "Bearer super-secret-token" } },
			"inbound request",
		);
		restore();
		const record = lastRecord(lines);
		const headers = record.headers as Record<string, unknown>;
		expect(headers.authorization).toBe("[Redacted]");
		expect(JSON.stringify(record)).not.toContain("super-secret-token");
	});

	test("redacts a top-level Authorization header (capitalized casing)", async () => {
		const { logger, lines, restore } = await loadLoggerCapturingStdout();
		logger.warn({ Authorization: "Bearer caps-token" }, "raw req headers");
		restore();
		const record = lastRecord(lines);
		expect(record.Authorization).toBe("[Redacted]");
		expect(JSON.stringify(record)).not.toContain("caps-token");
	});

	test("redacts token / secret / credential / password / apiKey fields", async () => {
		const { logger, lines, restore } = await loadLoggerCapturingStdout();
		logger.info(
			{
				token: "tok-1",
				tokenRef: "env:OPENROUTER_API_KEY-value",
				secret: "sec-1",
				credential: "cred-1",
				credentialRef: "vault:thing",
				password: "hunter2",
				apiKey: "sk-leak",
			},
			"config dump",
		);
		restore();
		const record = lastRecord(lines);
		for (const key of [
			"token",
			"tokenRef",
			"secret",
			"credential",
			"credentialRef",
			"password",
			"apiKey",
		]) {
			expect(record[key]).toBe("[Redacted]");
		}
		const serialized = JSON.stringify(record);
		for (const leaked of [
			"tok-1",
			"sec-1",
			"cred-1",
			"hunter2",
			"sk-leak",
			"vault:thing",
		]) {
			expect(serialized).not.toContain(leaked);
		}
	});

	test("redacts secret-bearing fields nested one level under any parent", async () => {
		const { logger, lines, restore } = await loadLoggerCapturingStdout();
		logger.info(
			{ chat: { apiKey: "nested-key", model: "gpt-4o-mini" } },
			"nested config",
		);
		restore();
		const record = lastRecord(lines);
		const chat = record.chat as Record<string, unknown>;
		expect(chat.apiKey).toBe("[Redacted]");
		// Non-secret sibling fields must survive untouched.
		expect(chat.model).toBe("gpt-4o-mini");
		expect(JSON.stringify(record)).not.toContain("nested-key");
	});

	test("leaves non-sensitive fields intact", async () => {
		const { logger, lines, restore } = await loadLoggerCapturingStdout();
		logger.info({ workspaceId: "ws-123", count: 7 }, "ordinary log");
		restore();
		const record = lastRecord(lines);
		expect(record.workspaceId).toBe("ws-123");
		expect(record.count).toBe(7);
		expect(record.msg).toBe("ordinary log");
	});
});
