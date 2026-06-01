/**
 * Unit tests for the shared setup auth gate.
 *
 * This middleware is the single source of truth for the bootstrap-token
 * posture on `POST /setup/env` and `POST /setup/restart`, used by both
 * the healthy-boot wizard (`routes/setup.ts`) and the rescue-mode app
 * (`rescue/app.ts`). The bearer compare must be constant-time and
 * length-safe (it hashes both sides before `timingSafeEqual`), so a
 * mismatched-length token can never throw and tokens of any length are
 * rejected cleanly.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, test } from "vitest";
import type { AuthConfig } from "../../src/config/schema.js";
import type { AppEnv } from "../../src/lib/types.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { setupAuthGate } from "../../src/setup/auth-gate.js";

function makeGateApp(opts: {
	authMode: "disabled" | "apiKey";
	bootstrapToken?: string;
}) {
	const auth: AuthConfig = {
		mode: opts.authMode,
		anonymousPolicy: "allow",
		acknowledgeOpenAccess: false,
		bootstrapTokenRef: opts.bootstrapToken
			? "env:WB_BOOTSTRAP_TOKEN_TEST"
			: null,
	};
	if (opts.bootstrapToken) {
		process.env.WB_BOOTSTRAP_TOKEN_TEST = opts.bootstrapToken;
	}
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const app = new Hono<AppEnv>();
	app.post("/gated", setupAuthGate({ auth, secrets }), (c) =>
		c.json({ ok: true }, 200),
	);
	return app;
}

function req(app: Hono<AppEnv>, token?: string) {
	return app.request("/gated", {
		method: "POST",
		headers: token ? { authorization: `Bearer ${token}` } : {},
	});
}

describe("setupAuthGate", () => {
	afterEach(() => {
		delete process.env.WB_BOOTSTRAP_TOKEN_TEST;
	});

	test("allows anonymous requests when auth.mode is disabled", async () => {
		const app = makeGateApp({ authMode: "disabled" });
		expect((await req(app)).status).toBe(200);
	});

	test("rejects anonymous requests when auth is enabled", async () => {
		const app = makeGateApp({ authMode: "apiKey" });
		expect((await req(app)).status).toBe(401);
	});

	test("accepts the correct bootstrap token when auth is enabled", async () => {
		const token = "correct-horse-battery-staple-token";
		const app = makeGateApp({ authMode: "apiKey", bootstrapToken: token });
		expect((await req(app, token)).status).toBe(200);
	});

	test("rejects a wrong bootstrap token of equal length", async () => {
		const app = makeGateApp({
			authMode: "apiKey",
			bootstrapToken: "correct-horse-battery-staple-token",
		});
		// Same length, different content — must not pass.
		expect((await req(app, "wrongg-horse-battery-staple-token!")).status).toBe(
			401,
		);
	});

	test("rejects a token of different length without throwing (length-safe)", async () => {
		const app = makeGateApp({
			authMode: "apiKey",
			bootstrapToken: "correct-horse-battery-staple-token",
		});
		// A naive `timingSafeEqual(presented, expected)` on raw buffers
		// throws RangeError on length mismatch; hashing first makes it
		// length-safe. A shorter and a longer candidate both yield 401.
		expect((await req(app, "x")).status).toBe(401);
		expect((await req(app, `${"x".repeat(200)}`)).status).toBe(401);
	});

	test("rejects a bearer when no bootstrap token is configured", async () => {
		const app = makeGateApp({ authMode: "apiKey" });
		expect((await req(app, "anything")).status).toBe(401);
	});
});
