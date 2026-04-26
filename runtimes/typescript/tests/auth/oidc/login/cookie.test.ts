import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	makeCookieSigner,
	parseCookie,
	type SessionPayload,
	serializeCookie,
} from "../../../../src/auth/oidc/login/cookie.js";

describe("makeCookieSigner", () => {
	const key = randomBytes(32);
	const signer = makeCookieSigner(key);

	test("round-trips a valid payload", () => {
		const value = signer.sign({ accessToken: "xyz", issuedAt: 1234 });
		expect(signer.verify(value)).toEqual({
			accessToken: "xyz",
			issuedAt: 1234,
		});
	});

	test("encrypts the payload rather than exposing token JSON", () => {
		const value = signer.sign({
			accessToken: "super-secret-jwt",
			issuedAt: 1234,
			refreshToken: "super-secret-refresh",
		});
		expect(value).toMatch(/^v2\./);
		expect(value).not.toContain("super-secret-jwt");
		expect(value).not.toContain("super-secret-refresh");
		expect(value).not.toContain("accessToken");
	});

	test("uses a fresh nonce for each cookie", () => {
		const payload = { accessToken: "xyz", issuedAt: 1234 };
		expect(signer.sign(payload)).not.toBe(signer.sign(payload));
	});

	test("rejects values with a tampered ciphertext", () => {
		const value = signer.sign({ accessToken: "xyz", issuedAt: 1234 });
		const parts = value.split(".");
		parts[2] = flipFirstChar(parts[2] ?? "");
		const tampered = parts.join(".");
		expect(signer.verify(tampered)).toBe(null);
	});

	test("rejects values with a tampered auth tag", () => {
		const value = signer.sign({ accessToken: "xyz", issuedAt: 1234 });
		const parts = value.split(".");
		parts[3] = flipFirstChar(parts[3] ?? "");
		const tampered = parts.join(".");
		expect(signer.verify(tampered)).toBe(null);
	});

	test("rejects values signed by a different key", () => {
		const other = makeCookieSigner(randomBytes(32));
		const fromOther = other.sign({ accessToken: "xyz", issuedAt: 1 });
		expect(signer.verify(fromOther)).toBe(null);
	});

	test("rejects malformed values", () => {
		expect(signer.verify("")).toBe(null);
		expect(signer.verify("nodotsihere")).toBe(null);
		expect(signer.verify("abc.!!!")).toBe(null);
		expect(signer.verify("v1.abc.def.ghi")).toBe(null);
	});

	test("rejects JSON without required fields", () => {
		const payload = signer.sign({
			issuedAt: 1,
		} as unknown as SessionPayload);
		expect(signer.verify(payload)).toBe(null);
	});
});

function flipFirstChar(value: string): string {
	if (value.length === 0) return "A";
	const replacement = value.startsWith("A") ? "B" : "A";
	return `${replacement}${value.slice(1)}`;
}

describe("serializeCookie", () => {
	test("emits HttpOnly + SameSite=Lax by default; Path=/", () => {
		const s = serializeCookie({ name: "wb_session", value: "abc" });
		expect(s).toMatch(/^wb_session=abc/);
		expect(s).toMatch(/; Path=\//);
		expect(s).toMatch(/; HttpOnly/);
		expect(s).toMatch(/; SameSite=Lax/);
		expect(s).not.toMatch(/; Secure/);
	});

	test("appends Secure when requested", () => {
		const s = serializeCookie({ name: "a", value: "b", secure: true });
		expect(s).toMatch(/; Secure/);
	});

	test("includes Max-Age when provided", () => {
		expect(
			serializeCookie({ name: "a", value: "b", maxAgeSeconds: 120 }),
		).toMatch(/; Max-Age=120/);
	});

	test("clamps negative Max-Age to 0 (logout-friendly)", () => {
		expect(
			serializeCookie({ name: "a", value: "", maxAgeSeconds: -1 }),
		).toMatch(/; Max-Age=0/);
	});
});

describe("parseCookie", () => {
	test("returns the named value", () => {
		expect(parseCookie("a=1; b=2; wb_session=hello", "wb_session")).toBe(
			"hello",
		);
	});
	test("returns null when not present or header blank", () => {
		expect(parseCookie("a=1", "wb_session")).toBe(null);
		expect(parseCookie(null, "wb_session")).toBe(null);
		expect(parseCookie("", "wb_session")).toBe(null);
	});
	test("handles leading whitespace", () => {
		expect(parseCookie("a=1 ;   wb_session=x", "wb_session")).toBe("x");
	});
	test("url-decodes the value", () => {
		expect(parseCookie("wb_session=hello%20world", "wb_session")).toBe(
			"hello world",
		);
	});
	test("returns null for malformed percent-encoding instead of throwing", () => {
		expect(parseCookie("wb_session=%E0%A4%A", "wb_session")).toBe(null);
	});
});
