import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	buildCliTelemetry,
	commandNameFromArgv,
	noopCliTelemetry,
} from "../src/telemetry.js";

describe("cli telemetry", () => {
	let configHome: string;
	let env: NodeJS.ProcessEnv;

	beforeEach(() => {
		configHome = mkdtempSync(join(tmpdir(), "aiw-cli-telemetry-"));
		env = { AIW_CONFIG_HOME: configHome };
	});

	afterEach(() => {
		rmSync(configHome, { recursive: true, force: true });
	});

	test("returns no-op when AIW_TELEMETRY is unset", () => {
		const fetchImpl = vi.fn();
		const t = buildCliTelemetry({ version: "0.0.0", env, fetchImpl });
		expect(t.enabled).toBe(false);
		t.emit("command_run", { command: "doctor" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test("dark mode: enabled without URL — emit doesn't POST", () => {
		const fetchImpl = vi.fn();
		const t = buildCliTelemetry({
			version: "0.0.0",
			env: { ...env, AIW_TELEMETRY: "1" },
			fetchImpl,
		});
		expect(t.enabled).toBe(true);
		expect(t.dark).toBe(true);
		t.emit("command_run", { command: "doctor" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test("live mode: POSTs command_run envelope to the sink", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		const t = buildCliTelemetry({
			version: "0.2.0",
			env: {
				...env,
				AIW_TELEMETRY: "1",
				AIW_TELEMETRY_URL: "https://sink.example/aiw",
			},
			fetchImpl,
		});
		t.emit("command_run", { command: "doctor" });
		await new Promise((r) => setImmediate(r));
		expect(fetchImpl).toHaveBeenCalledOnce();
		const [url, init] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe("https://sink.example/aiw");
		const body = JSON.parse(String((init as RequestInit).body));
		expect(body).toMatchObject({
			version: "0.2.0",
			event: "command_run",
			fields: { command: "doctor" },
		});
		expect(body.installId).toMatch(/^[a-f0-9]{32}$/);
	});

	test("network failures never throw", async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error("nope"));
		const t = buildCliTelemetry({
			version: "0.0.0",
			env: {
				...env,
				AIW_TELEMETRY: "1",
				AIW_TELEMETRY_URL: "https://unreachable",
			},
			fetchImpl,
		});
		expect(() => t.emit("error", { code: "x", exit: 1 })).not.toThrow();
		await new Promise((r) => setImmediate(r));
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	test("noopCliTelemetry is always a no-op", () => {
		const t = noopCliTelemetry();
		expect(t.enabled).toBe(false);
		expect(() => t.emit("x")).not.toThrow();
	});

	describe("commandNameFromArgv", () => {
		test("returns the first non-flag token", () => {
			expect(commandNameFromArgv(["node", "aiw", "workspace", "list"])).toBe(
				"workspace",
			);
		});
		test("skips flags before the command", () => {
			expect(
				commandNameFromArgv(["node", "aiw", "--profile", "dev", "doctor"]),
			).toBe("dev");
		});
		test("returns <unknown> when only flags are present", () => {
			expect(commandNameFromArgv(["node", "aiw", "--help"])).toBe("<unknown>");
		});
		test("returns <unknown> for an empty invocation", () => {
			expect(commandNameFromArgv(["node", "aiw"])).toBe("<unknown>");
		});
	});
});
