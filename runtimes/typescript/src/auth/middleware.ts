/**
 * Hono middleware that runs {@link AuthResolver.authenticate} on
 * every `/api/v1/*` request and tags the context with the resulting
 * {@link AuthContext}.
 *
 * Route handlers read `c.get("auth")` to check authentication /
 * authorization. Authorization enforcement lives in the route
 * handlers (see `auth/authz.ts`); this middleware only produces the
 * context.
 *
 * When a browser session cookie is configured (Phase 3b OIDC login),
 * a request without an `Authorization` header but with a valid
 * encrypted session cookie is treated as if it came in with
 * `Authorization: Bearer <session access_token>`. Bearer header
 * always wins if both are present — that matches the API-client
 * mental model (programmatic calls are never surprised by browser
 * state).
 */

import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/types.js";
import type { CookieSigner } from "./oidc/login/cookie.js";
import { parseCookie } from "./oidc/login/cookie.js";
import type { AuthResolver } from "./resolver.js";

export interface AuthMiddlewareOptions {
	readonly resolver: AuthResolver;
	readonly cookie?: {
		readonly name: string;
		readonly signer: CookieSigner;
	} | null;
}

export function authMiddleware(
	opts: AuthMiddlewareOptions | AuthResolver,
): MiddlewareHandler<AppEnv> {
	const resolved: AuthMiddlewareOptions =
		"authenticate" in opts ? { resolver: opts } : opts;

	return async (c, next) => {
		let req = c.req.raw;
		const cookieCfg = resolved.cookie;
		if (cookieCfg && !req.headers.get("authorization")) {
			const raw = parseCookie(req.headers.get("cookie"), cookieCfg.name);
			if (raw) {
				const payload = cookieCfg.signer.verify(decodeURIComponent(raw));
				if (payload) {
					const headers = new Headers(req.headers);
					headers.set("authorization", `Bearer ${payload.accessToken}`);
					req = new Request(req, { headers });
				}
			}
		}
		const auth = await resolved.resolver.authenticate(req);
		c.set("auth", auth);
		await next();
	};
}
