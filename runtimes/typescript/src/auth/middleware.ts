/**
 * Hono middleware that runs {@link AuthResolver.authenticate} on
 * every `/api/v1/*` request and tags the context with the resulting
 * {@link AuthContext}.
 *
 * Route handlers read `c.get("auth")` to check authentication /
 * authorization. Authorization enforcement (per-route role checks)
 * lands in PR #4 — this middleware only produces the context.
 */

import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/types.js";
import type { AuthResolver } from "./resolver.js";

export function authMiddleware(
	resolver: AuthResolver,
): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const auth = await resolver.authenticate(c.req.raw);
		c.set("auth", auth);
		await next();
	};
}
