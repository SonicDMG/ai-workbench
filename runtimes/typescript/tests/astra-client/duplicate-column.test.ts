/**
 * Regression coverage for {@link isAlreadyHasColumnError} — the
 * classifier that lets {@link ensureApiKeyScopesColumn} swallow the
 * "scopes already exists" alter failure on a re-boot of a deployment
 * that has already received the migration.
 *
 * The migration ran successfully the first time and then exploded
 * the second time because the Data API's actual error message
 * (`Column names must be unique in the table schema ... duplicate
 * columns: scopes(set)`) didn't match either of the two phrases the
 * original catch handler was looking for. Lock the classifier so a
 * future SDK phrasing change can't regress boot the same way.
 */

import { DataAPIResponseError } from "@datastax/astra-db-ts";
import { describe, expect, test } from "vitest";
import {
	ensureAdditiveColumns,
	isAlreadyHasColumnError,
} from "../../src/astra-client/client.js";

// Forge a DataAPIResponseError from a faked raw response. The
// public constructor signature on the upstream class isn't stable,
// so we build one through `Object.create` + `Object.assign` instead
// of `new` — the production code only reads `errorDescriptors`, and
// the getter just returns `rawResponse.errors` from the body.
function makeDataApiError(
	errors: ReadonlyArray<{ errorCode: string; message: string }>,
): DataAPIResponseError {
	const err = Object.create(
		DataAPIResponseError.prototype,
	) as DataAPIResponseError;
	const messageText = errors[0]?.message ?? "Something went wrong";
	Object.assign(err as unknown as Record<string, unknown>, {
		message: messageText,
		name: "DataAPIResponseError",
		rawResponse: { errors },
	});
	return err;
}

describe("isAlreadyHasColumnError", () => {
	test("matches the real CANNOT_ADD_EXISTING_COLUMNS error code", () => {
		const err = makeDataApiError([
			{
				errorCode: "CANNOT_ADD_EXISTING_COLUMNS",
				message:
					"Column names must be unique in the table schema. " +
					"The request included the following duplicate columns: scopes(set).",
			},
		]);
		expect(isAlreadyHasColumnError(err)).toBe(true);
	});

	test("matches a message-only 'duplicate columns' phrasing", () => {
		const err = new Error(
			"The request included the following duplicate columns: scopes(set).",
		);
		expect(isAlreadyHasColumnError(err)).toBe(true);
	});

	test("matches a message-only 'must be unique' phrasing", () => {
		const err = new Error("Column names must be unique in the table schema.");
		expect(isAlreadyHasColumnError(err)).toBe(true);
	});

	test("still matches the older 'already exists' phrasing", () => {
		const err = new Error("Column scopes already exists.");
		expect(isAlreadyHasColumnError(err)).toBe(true);
	});

	test("does NOT swallow an unrelated DataAPIResponseError", () => {
		const err = makeDataApiError([
			{
				errorCode: "PERMISSION_DENIED",
				message: "Token is not authorized to alter table schema.",
			},
		]);
		expect(isAlreadyHasColumnError(err)).toBe(false);
	});

	test("does NOT swallow a generic non-DB error", () => {
		expect(isAlreadyHasColumnError(new Error("network is down"))).toBe(false);
		expect(isAlreadyHasColumnError("not even an Error")).toBe(false);
		expect(isAlreadyHasColumnError(null)).toBe(false);
	});
});

describe("ensureAdditiveColumns", () => {
	test("adds known post-v1 control-plane columns one at a time", async () => {
		const attempts: Array<{ table: string; column: string }> = [];
		const db = {
			table(table: string) {
				return {
					async alter(options: {
						operation: {
							add?: { columns: Record<string, unknown> };
						};
					}) {
						for (const column of Object.keys(
							options.operation.add?.columns ?? {},
						)) {
							attempts.push({ table, column });
						}
					},
				};
			},
		};

		await ensureAdditiveColumns(
			db as unknown as Parameters<typeof ensureAdditiveColumns>[0],
		);

		expect(attempts).toEqual(
			expect.arrayContaining([
				{
					table: "wb_config_knowledge_bases_by_workspace",
					column: "vector_collection",
				},
				{
					table: "wb_config_knowledge_bases_by_workspace",
					column: "owned",
				},
				{
					table: "wb_config_knowledge_bases_by_workspace",
					column: "lexical_enabled",
				},
				{
					table: "wb_config_knowledge_bases_by_workspace",
					column: "lexical_analyzer",
				},
				{
					table: "wb_config_knowledge_bases_by_workspace",
					column: "lexical_options",
				},
			]),
		);
		expect(attempts.filter((a) => a.column === "lexical_enabled")).toHaveLength(
			1,
		);
	});
});
