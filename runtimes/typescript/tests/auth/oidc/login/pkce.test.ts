import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	challengeFor,
	generateState,
	generateVerifier,
} from "../../../../src/auth/oidc/login/pkce.js";

describe("PKCE helpers", () => {
	test("verifier is URL-safe and at least 43 chars", () => {
		const v = generateVerifier();
		expect(v).toMatch(/^[A-Za-z0-9_-]{43,}$/);
	});

	test("two verifiers are different", () => {
		expect(generateVerifier()).not.toBe(generateVerifier());
	});

	test("challenge is SHA-256(verifier) in base64url", () => {
		const v = "test-verifier-fixed-value";
		const expected = createHash("sha256")
			.update(v)
			.digest("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		expect(challengeFor(v)).toBe(expected);
	});

	test("state is a short URL-safe token", () => {
		const s = generateState();
		expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(s.length).toBeGreaterThanOrEqual(22);
	});
});
