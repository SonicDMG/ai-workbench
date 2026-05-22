import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	buildTelemetryEmitter,
	noopTelemetryEmitter,
} from "../../src/lib/telemetry.js";

describe("telemetry emitter", () => {
	let dataDir: string;
	let env: NodeJS.ProcessEnv;

	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), "aiw-telemetry-"));
		env = { WORKBENCH_DATA_DIR: dataDir };
	});

	afterEach(() => {
		rmSync(dataDir, { recursive: true, force: true });
	});

	test("returns a no-op when disabled (default)", () => {
		const fetchImpl = vi.fn();
		const t = buildTelemetryEmitter({
			config: { enabled: false, url: null },
			version: "0.0.0",
			env,
			fetchImpl,
		});
		expect(t.enabled).toBe(false);
		t.emit("runtime_start", { controlPlane: "memory" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test("enables via WORKBENCH_TELEMETRY env even when YAML is false", () => {
		const fetchImpl = vi.fn();
		const t = buildTelemetryEmitter({
			config: { enabled: false, url: null },
			version: "0.0.0",
			env: { ...env, WORKBENCH_TELEMETRY: "1" },
			fetchImpl,
		});
		expect(t.enabled).toBe(true);
		expect(t.dark).toBe(true);
	});

	test("dark mode: enabled but no URL — emit is a no-op", () => {
		const fetchImpl = vi.fn();
		const t = buildTelemetryEmitter({
			config: { enabled: true, url: null },
			version: "0.0.0",
			env,
			fetchImpl,
		});
		t.emit("runtime_start", { controlPlane: "memory" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	test("live mode: POSTs the documented envelope", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		const t = buildTelemetryEmitter({
			config: { enabled: true, url: "https://sink.example/aiw" },
			version: "0.2.0",
			env,
			fetchImpl,
		});
		t.emit("runtime_start", { controlPlane: "astra", authMode: "apiKey" });
		// fire-and-forget; flush microtasks so the fetch call is observed
		await new Promise((r) => setImmediate(r));
		expect(fetchImpl).toHaveBeenCalledOnce();
		const call = fetchImpl.mock.calls[0];
		expect(call?.[0]).toBe("https://sink.example/aiw");
		const init = call?.[1] as RequestInit;
		expect(init.method).toBe("POST");
		const body = JSON.parse(String(init.body));
		expect(body.event).toBe("runtime_start");
		expect(body.version).toBe("0.2.0");
		expect(body.fields).toEqual({
			controlPlane: "astra",
			authMode: "apiKey",
		});
		expect(typeof body.installId).toBe("string");
		expect(body.installId).toMatch(/^[a-f0-9]{32}$/);
	});

	test("WORKBENCH_TELEMETRY_URL overrides config.url", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		buildTelemetryEmitter({
			config: { enabled: true, url: "https://yaml.example" },
			version: "0.0.0",
			env: { ...env, WORKBENCH_TELEMETRY_URL: "https://env.example" },
			fetchImpl,
		}).emit("runtime_start");
		await new Promise((r) => setImmediate(r));
		expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://env.example");
	});

	test("install id persists across emitter constructions", () => {
		const t1 = buildTelemetryEmitter({
			config: { enabled: true, url: "https://sink.example" },
			version: "0.0.0",
			env,
			fetchImpl: vi.fn().mockResolvedValue(new Response()),
		});
		const path = join(dataDir, ".install-id");
		expect(readFileSync(path, "utf8").trim()).toBe(t1.installId);
		const t2 = buildTelemetryEmitter({
			config: { enabled: true, url: "https://sink.example" },
			version: "0.0.0",
			env,
			fetchImpl: vi.fn().mockResolvedValue(new Response()),
		});
		expect(t2.installId).toBe(t1.installId);
	});

	test("network failures are swallowed (telemetry never throws)", async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const t = buildTelemetryEmitter({
			config: { enabled: true, url: "https://unreachable" },
			version: "0.0.0",
			env,
			fetchImpl,
		});
		expect(() => t.emit("runtime_start")).not.toThrow();
		await new Promise((r) => setImmediate(r));
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	test("noopTelemetryEmitter is always a no-op", () => {
		const t = noopTelemetryEmitter();
		expect(t.enabled).toBe(false);
		expect(t.dark).toBe(false);
		expect(() => t.emit("anything")).not.toThrow();
	});
});
