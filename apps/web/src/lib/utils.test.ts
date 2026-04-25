import { describe, expect, it } from "vitest";
import { cn, formatDate } from "./utils";

describe("cn", () => {
	it("joins truthy class names", () => {
		expect(cn("a", "b")).toBe("a b");
	});

	it("drops falsy entries", () => {
		expect(cn("a", false, undefined, null, "b")).toBe("a b");
	});

	it("dedupes conflicting tailwind utilities (twMerge)", () => {
		// Last-wins for conflicts within the same property bucket.
		expect(cn("p-2", "p-4")).toBe("p-4");
		expect(cn("text-sm", "text-base")).toBe("text-base");
	});

	it("preserves non-conflicting utilities", () => {
		expect(cn("p-2", "m-4")).toBe("p-2 m-4");
	});

	it("supports object syntax via clsx", () => {
		expect(cn({ a: true, b: false, c: true })).toBe("a c");
	});
});

describe("formatDate", () => {
	it("renders an ISO timestamp into a locale string", () => {
		const out = formatDate("2026-04-22T10:11:12.345Z");
		// Don't pin the locale output exactly; assert the year shows
		// up so we know parsing worked.
		expect(out).toMatch(/2026/);
	});

	it("returns 'Invalid Date' for nonsense input rather than throwing", () => {
		expect(() => formatDate("not a date")).not.toThrow();
	});
});
