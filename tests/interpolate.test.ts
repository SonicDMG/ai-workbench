// biome-ignore-all lint/suspicious/noTemplateCurlyInString: tests intentionally use plain strings containing ${VAR} to verify interpolation

import { describe, expect, test } from "vitest";
import { interpolate, MissingEnvError } from "../src/config/interpolate.js";

describe("interpolate", () => {
	test("replaces ${VAR} with env value", () => {
		expect(interpolate("hello ${NAME}", { NAME: "world" })).toBe("hello world");
	});

	test("supports multiple interpolations in one string", () => {
		expect(interpolate("${A}/${B}", { A: "foo", B: "bar" })).toBe("foo/bar");
	});

	test("uses default when variable unset", () => {
		expect(interpolate("${MISSING:-fallback}", {})).toBe("fallback");
	});

	test("prefers env value over default", () => {
		expect(interpolate("${NAME:-fallback}", { NAME: "set" })).toBe("set");
	});

	test("throws on unset variable without default", () => {
		expect(() => interpolate("${MISSING}", {})).toThrow(MissingEnvError);
	});

	test("walks nested objects and arrays", () => {
		const result = interpolate(
			{ a: "${X}", b: [{ c: "${Y:-def}" }] },
			{ X: "1" },
		);
		expect(result).toEqual({ a: "1", b: [{ c: "def" }] });
	});

	test("passes non-string primitives through", () => {
		expect(interpolate({ n: 42, b: true, z: null }, {})).toEqual({
			n: 42,
			b: true,
			z: null,
		});
	});

	test("MissingEnvError exposes variable + path", () => {
		try {
			interpolate({ a: { b: "${ABSENT}" } }, {});
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(MissingEnvError);
			expect((err as MissingEnvError).variable).toBe("ABSENT");
			expect((err as MissingEnvError).path).toBe("$.a.b");
		}
	});
});
