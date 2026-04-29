import type { Context } from "hono";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { audit } from "../../src/lib/audit.js";
import { logger } from "../../src/lib/logger.js";
import type { AppEnv } from "../../src/lib/types.js";

interface FakeStore {
	requestId?: string;
	auth?: unknown;
}

function makeCtx(store: FakeStore = {}): Context<AppEnv> {
	const stash = new Map<string, unknown>();
	if (store.requestId !== undefined) stash.set("requestId", store.requestId);
	if (store.auth !== undefined) stash.set("auth", store.auth);
	const ctx = {
		get: (key: string) => stash.get(key),
		set: (key: string, value: unknown) => {
			stash.set(key, value);
		},
	} as unknown as Context<AppEnv>;
	return ctx;
}

function firstCallArgs(spy: { mock: { calls: unknown[][] } }): unknown[] {
	const call = spy.mock.calls[0];
	if (!call) throw new Error("expected logger.info to have been called");
	return call;
}

describe("audit()", () => {
	let infoSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
	});

	afterEach(() => {
		infoSpy.mockRestore();
	});

	test("emits a single envelope with audit:true", () => {
		const ctx = makeCtx({
			requestId: "req-123",
			auth: {
				mode: "apiKey",
				authenticated: true,
				anonymous: false,
				subject: {
					type: "apiKey",
					id: "key-abc",
					label: "ci-deployer",
					workspaceScopes: ["ws-1"],
				},
			},
		});

		audit(ctx, {
			action: "api_key.create",
			outcome: "success",
			workspaceId: "ws-1",
			details: { keyId: "key-abc", label: "ci-deployer" },
		});

		expect(infoSpy).toHaveBeenCalledTimes(1);
		const [envelope, message] = firstCallArgs(infoSpy);
		expect(envelope).toMatchObject({
			audit: true,
			action: "api_key.create",
			outcome: "success",
			requestId: "req-123",
			workspaceId: "ws-1",
			subject: { type: "apiKey", id: "key-abc", label: "ci-deployer" },
			details: { keyId: "key-abc", label: "ci-deployer" },
		});
		expect(message).toBe("audit api_key.create success");
	});

	test("normalizes anonymous subjects", () => {
		const ctx = makeCtx({
			requestId: "req-xyz",
			auth: {
				mode: "disabled",
				authenticated: false,
				anonymous: true,
				subject: null,
			},
		});

		audit(ctx, { action: "auth.login", outcome: "failure" });

		const [envelope] = firstCallArgs(infoSpy);
		expect(envelope).toMatchObject({
			subject: { type: "anonymous", id: null, label: null },
			workspaceId: null,
			details: null,
		});
	});

	test("sets requestId/auth to null when missing on the context", () => {
		const ctx = makeCtx();
		audit(ctx, { action: "workspace.create", outcome: "success" });
		const [envelope] = firstCallArgs(infoSpy);
		expect(envelope).toMatchObject({
			requestId: null,
			subject: null,
			workspaceId: null,
		});
	});

	test("never throws when the logger does", () => {
		infoSpy.mockImplementation(() => {
			throw new Error("logger failed");
		});
		const ctx = makeCtx();
		expect(() =>
			audit(ctx, { action: "api_key.revoke", outcome: "success" }),
		).not.toThrow();
	});

	test("does not include secret-shaped fields in details", () => {
		const ctx = makeCtx();
		// The type system already restricts callers; this guards against
		// regressions where someone widens AuditDetails carelessly.
		audit(ctx, {
			action: "api_key.create",
			outcome: "success",
			details: { keyId: "key-1" },
		});
		const [envelope] = firstCallArgs(infoSpy);
		const serialized = JSON.stringify(envelope);
		expect(serialized).not.toMatch(/plaintext|hash|secret|refreshToken/i);
	});
});
