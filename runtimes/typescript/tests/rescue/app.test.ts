/**
 * Tests for the rescue-mode HTTP app.
 *
 * Rescue mode runs when control-plane init throws (typo'd Astra
 * endpoint, bad token, network unreachable, …). The minimal app
 * must:
 *   - report the boot failure via `/setup-status` so the SPA shows
 *     a banner steering the operator to `/settings`,
 *   - accept `/setup/env` writes (same allow-list, same file) so
 *     the credentials can be corrected,
 *   - trigger `/setup/restart` so the container restart policy
 *     brings the runtime back with the new env,
 *   - return 503 on `/api/v1/*` so callers see a clean failure
 *     instead of a 404,
 *   - and return 503 from `/healthz` so external probes know the
 *     runtime is degraded.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AuthConfig } from "../../src/config/schema.js";
import { buildRescueApp, classifyBootError } from "../../src/rescue/app.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";

function makeApp(opts?: {
	triggerRestart?: () => void;
	authMode?: "disabled" | "apiKey";
	bootstrapToken?: string;
}) {
	const auth: AuthConfig = {
		mode: opts?.authMode ?? "disabled",
		anonymousPolicy: "allow",
		acknowledgeOpenAccess: false,
		bootstrapTokenRef: opts?.bootstrapToken
			? "env:WB_BOOTSTRAP_TOKEN_TEST"
			: null,
	};
	if (opts?.bootstrapToken) {
		process.env.WB_BOOTSTRAP_TOKEN_TEST = opts.bootstrapToken;
	}
	return buildRescueApp({
		bootError: {
			code: "control_plane_dns_unresolvable",
			message:
				"getaddrinfo ENOTFOUND fake-db-id-us-east-2.apps.astra.datastax.com",
		},
		triggerRestart: opts?.triggerRestart ?? (() => undefined),
		ui: null,
		auth,
		secrets: new SecretResolver({ env: new EnvSecretProvider() }),
	});
}

describe("rescue app", () => {
	let dataDir: string;

	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), "aiw-rescue-"));
		process.env.WORKBENCH_DATA_DIR = dataDir;
	});
	afterEach(() => {
		delete process.env.WORKBENCH_DATA_DIR;
		delete process.env.WB_BOOTSTRAP_TOKEN_TEST;
		rmSync(dataDir, { recursive: true, force: true });
	});

	test("/healthz and /readyz both return 503 with the boot-error code", async () => {
		const app = makeApp();
		const health = await app.request("/healthz");
		const ready = await app.request("/readyz");
		expect(health.status).toBe(503);
		expect(ready.status).toBe(503);
		const healthBody = (await health.json()) as {
			status: string;
			reason: string;
		};
		expect(healthBody.status).toBe("degraded");
		expect(healthBody.reason).toBe("control_plane_dns_unresolvable");
	});

	test("/setup-status surfaces the classified bootError", async () => {
		const app = makeApp();
		const res = await app.request("/setup-status");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			setupComplete: boolean;
			controlPlane: { healthy: boolean };
			bootError: { code: string; message: string };
		};
		expect(body.setupComplete).toBe(false);
		expect(body.controlPlane.healthy).toBe(false);
		expect(body.bootError.code).toBe("control_plane_dns_unresolvable");
		expect(body.bootError.message).toMatch(/ENOTFOUND/);
	});

	test("/setup/env writes the managed file when auth.mode is disabled", async () => {
		const app = makeApp();
		const res = await app.request("/setup/env", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				values: { OPENROUTER_API_KEY: "hf_corrected_token" },
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; written: string[] };
		expect(body.ok).toBe(true);
		expect(body.written).toEqual(["OPENROUTER_API_KEY"]);
		const contents = readFileSync(join(dataDir, ".env"), "utf8");
		expect(contents).toContain('OPENROUTER_API_KEY="hf_corrected_token"');
	});

	test("/setup/env rejects an unauthenticated write when auth is enabled (401)", async () => {
		// The whole point of the fix: a control-plane boot failure must
		// NOT drop the bootstrap-token requirement and leave an open
		// credential-tampering path in rescue mode.
		const app = makeApp({ authMode: "apiKey" });
		const res = await app.request("/setup/env", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				values: { OPENROUTER_API_KEY: "hf_attacker_token" },
			}),
		});
		expect(res.status).toBe(401);
		// And nothing was written.
		expect(() => readFileSync(join(dataDir, ".env"), "utf8")).toThrow();
	});

	test("/setup/env accepts the bootstrap token when auth is enabled", async () => {
		const token = "bootstrap-token-32-characters-min-ok";
		const app = makeApp({ authMode: "apiKey", bootstrapToken: token });
		const res = await app.request("/setup/env", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				values: { OPENROUTER_API_KEY: "hf_corrected_token" },
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; written: string[] };
		expect(body.ok).toBe(true);
		expect(body.written).toEqual(["OPENROUTER_API_KEY"]);
	});

	test("/setup/env rejects a wrong bootstrap token when auth is enabled (401)", async () => {
		const app = makeApp({
			authMode: "apiKey",
			bootstrapToken: "the-real-bootstrap-token-value-ok",
		});
		const res = await app.request("/setup/env", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer not-the-real-token",
			},
			body: JSON.stringify({
				values: { OPENROUTER_API_KEY: "hf_attacker_token" },
			}),
		});
		expect(res.status).toBe(401);
	});

	test("/setup/env rejects keys outside the allow-list", async () => {
		const app = makeApp();
		const res = await app.request("/setup/env", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ values: { PATH: "/evil" } }),
		});
		expect(res.status).toBe(400);
	});

	test("/setup/restart calls the registered hook when auth.mode is disabled", async () => {
		const trigger = vi.fn();
		const app = makeApp({ triggerRestart: trigger });
		const res = await app.request("/setup/restart", { method: "POST" });
		expect(res.status).toBe(202);
		await new Promise((r) => setImmediate(r));
		expect(trigger).toHaveBeenCalledOnce();
	});

	test("/setup/restart is gated by the bootstrap token when auth is enabled", async () => {
		const trigger = vi.fn();
		const app = makeApp({ authMode: "apiKey", triggerRestart: trigger });
		const res = await app.request("/setup/restart", { method: "POST" });
		expect(res.status).toBe(401);
		await new Promise((r) => setImmediate(r));
		expect(trigger).not.toHaveBeenCalled();
	});

	test("/setup-status stays open even when auth is enabled", async () => {
		// The status endpoint must render the rescue banner without a
		// token; only the mutating routes are gated.
		const app = makeApp({ authMode: "apiKey" });
		const res = await app.request("/setup-status");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { bootError: { code: string } };
		expect(body.bootError.code).toBe("control_plane_dns_unresolvable");
	});

	test("/api/v1/* returns 503 control_plane_unavailable", async () => {
		const app = makeApp();
		const res = await app.request("/api/v1/workspaces");
		expect(res.status).toBe(503);
		const body = (await res.json()) as {
			error: { code: string; message: string };
		};
		expect(body.error.code).toBe("control_plane_unavailable");
		expect(body.error.message).toMatch(/rescue mode/i);
	});
});

describe("classifyBootError", () => {
	test("ENOTFOUND maps to control_plane_dns_unresolvable", () => {
		const err = Object.assign(new Error("getaddrinfo ENOTFOUND foo"), {
			code: "ENOTFOUND",
		});
		expect(classifyBootError(err).code).toBe("control_plane_dns_unresolvable");
	});

	test("ETIMEDOUT and ECONNREFUSED both map to control_plane_unreachable", () => {
		const timeout = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
		const refused = Object.assign(new Error("refused"), {
			code: "ECONNREFUSED",
		});
		expect(classifyBootError(timeout).code).toBe("control_plane_unreachable");
		expect(classifyBootError(refused).code).toBe("control_plane_unreachable");
	});

	test("401 / unauthorized messages map to control_plane_unauthorized", () => {
		expect(classifyBootError(new Error("HTTP 401 unauthorized")).code).toBe(
			"control_plane_unauthorized",
		);
		expect(classifyBootError(new Error("invalid token presented")).code).toBe(
			"control_plane_unauthorized",
		);
	});

	test("403 / forbidden maps to control_plane_forbidden", () => {
		expect(classifyBootError(new Error("HTTP 403 forbidden")).code).toBe(
			"control_plane_forbidden",
		);
	});

	test("unknown errors fall through to control_plane_unavailable", () => {
		expect(classifyBootError(new Error("something else broke")).code).toBe(
			"control_plane_unavailable",
		);
		expect(classifyBootError("a bare string").code).toBe(
			"control_plane_unavailable",
		);
	});

	test("always preserves the original error message verbatim", () => {
		const err = new Error("very specific error string");
		expect(classifyBootError(err).message).toBe("very specific error string");
	});
});
