import { describe, expect, test } from "vitest";
import { safeErrorMessage } from "../src/lib/safe-error.js";

describe("safeErrorMessage", () => {
	test("redacts common credential shapes", () => {
		const message = safeErrorMessage(
			new Error(
				"failed with token=AstraCS:abc123 and Authorization: Bearer wb_live_aaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", // secret-scan: allow
			),
		);
		expect(message).not.toContain("AstraCS:abc123");
		expect(message).not.toContain("wb_live_aaaaaaaaaaaa");
		expect(message).toContain("[redacted]");
	});

	test("bounds very long provider messages", () => {
		const message = safeErrorMessage(new Error("x".repeat(1000)));
		expect(message.length).toBeLessThanOrEqual(500);
		expect(message.endsWith("…")).toBe(true);
	});
});
