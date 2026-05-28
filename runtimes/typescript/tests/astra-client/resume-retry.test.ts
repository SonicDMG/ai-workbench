/**
 * Regression coverage for {@link isAstraResumingError} +
 * {@link waitForAstraResume} — the boot-time wrapper that lets the
 * runtime tolerate a paused Astra Serverless DB.
 *
 * The runtime used to crash at startup with `HTTP 503 — Resuming
 * your database, please try again shortly.` (issue #246). Lock the
 * retry classifier and the backoff loop so a future SDK or message
 * change can't silently regress this.
 */

import { DataAPIHttpError, DataAPIResponseError } from "@datastax/astra-db-ts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	isAstraResumingError,
	waitForAstraResume,
} from "../../src/astra-client/client.js";
import { logger } from "../../src/lib/logger.js";

// The public constructors of the SDK error classes aren't stable.
// The production classifier only reads `status` + `body`, so we
// forge instances via `Object.create` + `Object.assign`, same as
// `duplicate-column.test.ts` does for `DataAPIResponseError`.
function makeHttpError(status: number, body: string): DataAPIHttpError {
	const err = Object.create(DataAPIHttpError.prototype) as DataAPIHttpError;
	Object.assign(err as unknown as Record<string, unknown>, {
		message: `HTTP error (${status}): ${body}`,
		name: "DataAPIHttpError",
		status,
		body,
	});
	return err;
}

function makeDataApiResponseError(
	errors: ReadonlyArray<{ errorCode: string; message: string }>,
): DataAPIResponseError {
	const err = Object.create(
		DataAPIResponseError.prototype,
	) as DataAPIResponseError;
	Object.assign(err as unknown as Record<string, unknown>, {
		message: errors[0]?.message ?? "Something went wrong",
		name: "DataAPIResponseError",
		rawResponse: { errors },
	});
	return err;
}

const RESUME_BODY =
	'{"message":"Resuming your database, please try again shortly."}';

/**
 * The newer Astra wire shape observed when a hibernated DB wakes up
 * mid-cycle: status flips from 503 → 400 and the body phrasing flips
 * from "resuming your database" → "resuming from hibernation". Both
 * mean the same thing operationally; we have to classify both as
 * "still resuming" or boot crashes on the second retry attempt.
 */
const HIBERNATION_BODY =
	'{"message":"Your database is resuming from hibernation and will be available in the next few minutes."}';

describe("isAstraResumingError", () => {
	test("classifies the legacy 503 resume payload", () => {
		expect(isAstraResumingError(makeHttpError(503, RESUME_BODY))).toBe(true);
	});

	test("classifies the newer 400 'resuming from hibernation' payload", () => {
		expect(isAstraResumingError(makeHttpError(400, HIBERNATION_BODY))).toBe(
			true,
		);
	});

	test("classifies a 503 carrying the hibernation phrasing too (defensive)", () => {
		// Astra has been observed using either status with either
		// phrasing across LB hand-offs; accept the cross-product so a
		// future SDK consolidation doesn't regress us.
		expect(isAstraResumingError(makeHttpError(503, HIBERNATION_BODY))).toBe(
			true,
		);
	});

	test("rejects 503 with an unrelated body", () => {
		expect(
			isAstraResumingError(
				makeHttpError(503, '{"message":"Backend overloaded"}'),
			),
		).toBe(false);
	});

	test("rejects 400 with an unrelated body (a real validation error)", () => {
		expect(
			isAstraResumingError(
				makeHttpError(400, '{"message":"invalid column name"}'),
			),
		).toBe(false);
	});

	test("rejects non-503/non-400 statuses even with a resume-like body", () => {
		expect(isAstraResumingError(makeHttpError(401, RESUME_BODY))).toBe(false);
		expect(isAstraResumingError(makeHttpError(502, RESUME_BODY))).toBe(false);
		expect(isAstraResumingError(makeHttpError(504, RESUME_BODY))).toBe(false);
	});

	test("rejects DataAPIResponseError (wrong shape, has no status)", () => {
		const err = makeDataApiResponseError([
			{
				errorCode: "SERVER_UNAVAILABLE",
				message: "Resuming your database, please try again shortly.",
			},
		]);
		expect(isAstraResumingError(err)).toBe(false);
	});

	test("rejects generic non-DB errors", () => {
		expect(isAstraResumingError(new Error("network is down"))).toBe(false);
		expect(isAstraResumingError("not an Error")).toBe(false);
		expect(isAstraResumingError(null)).toBe(false);
	});
});

describe("waitForAstraResume", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	test("retries on resume errors and eventually succeeds", async () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		let calls = 0;
		const op = vi.fn(async () => {
			calls += 1;
			if (calls < 3) throw makeHttpError(503, RESUME_BODY);
			return "ready" as const;
		});

		const promise = waitForAstraResume(op, {
			initialDelayMs: 10,
			maxDelayMs: 20,
			totalTimeoutMs: 10_000,
		});

		// Drain pending timers from each retry's sleep.
		await vi.runAllTimersAsync();
		const result = await promise;

		expect(result).toBe("ready");
		expect(op).toHaveBeenCalledTimes(3);
		// One warn line per retry (i.e. before each non-final attempt).
		expect(warnSpy).toHaveBeenCalledTimes(2);
	});

	test("tolerates the wire shape rotating mid-cycle (503 legacy → 400 hibernation)", async () => {
		// Reproduces the boot crash observed in the wild: the first
		// retry attempt got the 503 envelope, the second attempt got
		// the newer 400/"resuming from hibernation" envelope, and the
		// classifier rejected the second shape and bailed the loop.
		// With both shapes classified, the loop continues to the
		// eventual success.
		vi.spyOn(logger, "warn").mockImplementation(() => {});
		let calls = 0;
		const op = vi.fn(async () => {
			calls += 1;
			if (calls === 1) throw makeHttpError(503, RESUME_BODY);
			if (calls === 2) throw makeHttpError(400, HIBERNATION_BODY);
			return "ready" as const;
		});

		const promise = waitForAstraResume(op, {
			initialDelayMs: 10,
			maxDelayMs: 20,
			totalTimeoutMs: 10_000,
		});
		await vi.runAllTimersAsync();
		const result = await promise;

		expect(result).toBe("ready");
		expect(op).toHaveBeenCalledTimes(3);
	});

	test("surfaces non-resume errors immediately, no retry", async () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		const op = vi.fn(async () => {
			throw new Error("auth token rejected");
		});

		await expect(
			waitForAstraResume(op, {
				initialDelayMs: 10,
				maxDelayMs: 20,
				totalTimeoutMs: 10_000,
			}),
		).rejects.toThrow("auth token rejected");

		expect(op).toHaveBeenCalledTimes(1);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	test("rethrows the last resume error when the timeout is exhausted", async () => {
		vi.spyOn(logger, "warn").mockImplementation(() => {});
		const lastErr = makeHttpError(503, RESUME_BODY);
		const op = vi.fn(async () => {
			throw lastErr;
		});

		const promise = waitForAstraResume(op, {
			initialDelayMs: 10,
			maxDelayMs: 10,
			totalTimeoutMs: 50,
		});
		// Surface the rejection so vitest doesn't flag an unhandled
		// promise while we're draining timers.
		const settled = promise.catch((err) => err);
		await vi.runAllTimersAsync();
		const err = await settled;

		expect(err).toBe(lastErr);
		// >1 attempt: the loop tried, slept, and retried at least once
		// before the budget ran out. Exact count depends on timer
		// scheduling — assert the lower bound.
		expect(op.mock.calls.length).toBeGreaterThanOrEqual(2);
	});
});
