import { randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { ulid } from "ulid";
import type { AppEnv } from "./types.js";

export const DEFAULT_HEADER = "X-Request-Id";

/**
 * W3C trace-context format (https://www.w3.org/TR/trace-context/):
 *   `version-traceId-parentId-flags`
 *   `00-<32 hex>-<16 hex>-<2 hex>`
 *
 * The all-zero trace-id and parent-id are explicitly forbidden by the
 * spec; treat them as malformed.
 */
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE_ID = "00000000000000000000000000000000";
const ZERO_PARENT_ID = "0000000000000000";

interface ParsedTraceparent {
	readonly traceId: string;
	readonly parentId: string;
	readonly flags: string;
}

function parseTraceparent(value: string | undefined): ParsedTraceparent | null {
	if (!value) return null;
	const match = TRACEPARENT_RE.exec(value.trim());
	if (!match) return null;
	const traceId = match[1];
	const parentId = match[2];
	const flags = match[3];
	if (!traceId || !parentId || !flags) return null;
	if (traceId === ZERO_TRACE_ID || parentId === ZERO_PARENT_ID) return null;
	return { traceId, parentId, flags };
}

function synthesizeTraceparent(): string {
	// Fresh trace-id + parent-id; sampled (`01`) so downstream services
	// honor the trace by default. Operators can flip this in a future
	// runtime config knob if needed.
	const traceId = randomBytes(16).toString("hex");
	const parentId = randomBytes(8).toString("hex");
	return `00-${traceId}-${parentId}-01`;
}

/**
 * Resolve a per-request id from incoming headers + tag the response
 * with both the legacy `X-Request-Id` and a W3C-compliant
 * `traceparent`.
 *
 * Resolution order for `requestId`:
 *   1. The configured `headerName` (default `X-Request-Id`) — operator
 *      override, highest priority.
 *   2. The trace-id portion of a valid inbound `traceparent` — natural
 *      correlation id when the runtime sits behind a service mesh /
 *      OpenTelemetry-instrumented client.
 *   3. A fresh ULID — random, sortable, no upstream context.
 *
 * The response always carries a `traceparent`: the inbound one when
 * valid, otherwise a synthesized one so downstream consumers can keep
 * correlating.
 */
export function requestId(
	headerName: string = DEFAULT_HEADER,
): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const incoming = c.req.header(headerName);
		const traceparent = parseTraceparent(c.req.header("traceparent"));

		let id: string;
		if (incoming && incoming.length > 0) {
			id = incoming;
		} else if (traceparent) {
			id = traceparent.traceId;
		} else {
			id = ulid();
		}

		c.set("requestId", id);
		c.header(headerName, id);
		c.header(
			"traceparent",
			traceparent
				? `00-${traceparent.traceId}-${traceparent.parentId}-${traceparent.flags}`
				: synthesizeTraceparent(),
		);

		await next();
	};
}
