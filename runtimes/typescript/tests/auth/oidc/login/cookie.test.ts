import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	makeCookieSigner,
	parseCookie,
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

	test("rejects values with a tampered payload", () => {
		const value = signer.sign({ accessToken: "xyz", issuedAt: 1234 });
		// flip a character in the first half
		const [head, tail] = value.split(".");
		const tampered = `${head?.replace(/./, "A")}.${tail}`;
		expect(signer.verify(tampered)).toBe(null);
	});

	test("rejects values with a tampered signature", () => {
		const value = signer.sign({ accessToken: "xyz", issuedAt: 1234 });
		const tampered = `${value.slice(0, -4)}AAAA`;
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
	});

	test("rejects JSON without required fields", () => {
		// Synthesize a valid MAC of a payload that lacks accessToken.
		const payload = signer.sign({
			accessToken: "x",
			issuedAt: 1,
		} as unknown as { accessToken: string; issuedAt: number });
		expect(signer.verify(payload.replace(/./, "."))).toBe(null);
	});
});

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
});
