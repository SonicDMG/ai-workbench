import { describe, expect, it } from "vitest";
import { parseOutputFormat, renderTable } from "../src/output.js";

describe("parseOutputFormat", () => {
	it("defaults to human", () => {
		expect(parseOutputFormat(undefined)).toBe("human");
	});
	it("accepts 'human' and 'json'", () => {
		expect(parseOutputFormat("human")).toBe("human");
		expect(parseOutputFormat("json")).toBe("json");
	});
	it("throws on unknown values", () => {
		expect(() => parseOutputFormat("yaml")).toThrow();
	});
});

describe("renderTable", () => {
	it("renders headers, separators, and rows", () => {
		const out = renderTable(
			[
				{ id: "a", name: "alpha" },
				{ id: "bb", name: "beta" },
			],
			[
				{ header: "ID", value: (r) => r.id },
				{ header: "NAME", value: (r) => r.name },
			],
		);
		const [header, sep, row1, row2] = out.split("\n");
		expect(header?.trim().split(/\s+/)).toEqual(["ID", "NAME"]);
		expect(sep).toMatch(/^-+\s+-+$/);
		expect(row1).toContain("a");
		expect(row1).toContain("alpha");
		expect(row2).toContain("bb");
		expect(row2).toContain("beta");
	});

	it("handles the empty case", () => {
		expect(renderTable([], [{ header: "X", value: () => "" }])).toBe(
			"(no rows)",
		);
	});
});
