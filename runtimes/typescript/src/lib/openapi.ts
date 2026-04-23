/**
 * Factory for {@link OpenAPIHono} instances that route validation
 * failures through the canonical error envelope.
 *
 * The `@hono/zod-openapi` library parses every request body / params /
 * query against the Zod schemas declared on the route. When validation
 * fails, the library's default behavior is to respond with a
 * library-shaped payload (`{success: false, error: {name: "ZodError",
 * ...}}`) — NOT the canonical workbench envelope. Clients (including
 * our web UI) parse only the canonical shape, so validation errors
 * surface as generic "unknown_error" on the client.
 *
 * Passing a `defaultHook` lets us intercept every validation failure
 * and produce `{error: {code: "validation_error", message, requestId}}`
 * — matching every other error the runtime emits.
 *
 * Use this everywhere instead of `new OpenAPIHono(...)` directly.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { errorEnvelope } from "./errors.js";
import type { AppEnv } from "./types.js";

export function makeOpenApi(): OpenAPIHono<AppEnv> {
	return new OpenAPIHono<AppEnv>({
		defaultHook: (result, c) => {
			if (result.success) return;
			// ZodError's `issues` array has structured per-field details.
			// Surface the first one in `message` for quick triage; clients
			// that need the full list can log the response body server-side.
			const first = result.error.issues[0];
			const path = first?.path?.join(".") ?? "";
			const detail = first?.message ?? "validation failed";
			const message = path ? `${path}: ${detail}` : detail;
			return c.json(errorEnvelope(c, "validation_error", message), 400);
		},
	});
}
