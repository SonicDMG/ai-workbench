import { describe, expect, it } from "vitest";
import { ApiError, formatApiError } from "./api";

describe("formatApiError", () => {
	it("renders ApiError as 'code: message'", () => {
		const err = new ApiError(404, "workspace_not_found", "no such ws", "rid-1");
		expect(formatApiError(err)).toBe("workspace_not_found: no such ws");
	});

	it("falls through to plain Error.message", () => {
		expect(formatApiError(new Error("boom"))).toBe("boom");
	});

	it("returns 'Unknown error' for non-Error values", () => {
		expect(formatApiError(undefined)).toBe("Unknown error");
		expect(formatApiError(null)).toBe("Unknown error");
		expect(formatApiError("string thrown")).toBe("Unknown error");
		expect(formatApiError({ shape: "object" })).toBe("Unknown error");
	});
});
