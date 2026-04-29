import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./types.js";

/**
 * Pinned Scalar bundle the `/docs` page loads from a CDN. We pin a
 * specific major+minor so nothing on jsdelivr can swap the script
 * out from under us between releases — bumping the docs UI is now an
 * explicit version edit here rather than a silent CDN refresh.
 *
 * If we ever vendor `@scalar/api-reference` into the image, drop the
 * relaxed CSP for `/docs` along with this constant.
 */
export const SCALAR_CDN_PINNED =
	"https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.53.1";

/**
 * Default CSP applied to every response. The strict variant — no
 * `unsafe-inline` for scripts, no third-party CDN. Scripts and the
 * SPA bundle ship from `'self'`. Inline `style="..."` attributes are
 * still allowed (React's `style={{...}}` prop is everywhere in the
 * UI); switching to nonces here would require templating
 * `index.html` per request and regenerating Vite's emitted style
 * blocks, which we'd rather not pay for at this stage.
 *
 * Google Fonts is whitelisted because the SPA's `index.html` loads
 * its typography stylesheet from `fonts.googleapis.com` and the
 * resulting `@font-face` rules fetch woff2 from `fonts.gstatic.com`.
 * Drop those two entries the moment we self-host the fonts.
 */
const DEFAULT_CSP_DIRECTIVES = [
	"default-src 'self'",
	"base-uri 'self'",
	"connect-src 'self'",
	"font-src 'self' data: https://fonts.gstatic.com",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"img-src 'self' data:",
	"object-src 'none'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
];

/**
 * Relaxed CSP applied only to `/docs` (Scalar's reference UI). The
 * library injects an inline bootstrap `<script>` and loads its
 * standalone bundle from a CDN — both are unavoidable today without
 * forking Scalar. The CDN entry is the pinned URL above; `unsafe-
 * inline` is scoped to this single route, not the whole app.
 */
const DOCS_CSP_DIRECTIVES = [
	"default-src 'self'",
	"base-uri 'self'",
	"connect-src 'self' https://cdn.jsdelivr.net",
	"font-src 'self' data: https://cdn.jsdelivr.net",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"img-src 'self' data: https://cdn.jsdelivr.net",
	"object-src 'none'",
	"script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
	"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
];

const DEFAULT_CSP = DEFAULT_CSP_DIRECTIVES.join("; ");
const DOCS_CSP = DOCS_CSP_DIRECTIVES.join("; ");

/**
 * `Strict-Transport-Security` value emitted when `hsts: true`. 180 days
 * is the conservative middle ground IETF / OWASP both recommend: long
 * enough to be effective, short enough that an HTTPS misconfiguration
 * recovers within a release cycle. We do **not** emit `preload` —
 * preload list submissions are an explicit deployment-side decision,
 * not something the runtime should opt into on the operator's behalf.
 */
const HSTS_VALUE = "max-age=15552000; includeSubDomains";

export interface SecurityHeadersOptions {
	/**
	 * `"default"` — strict CSP for the SPA, JSON API, and operational
	 * endpoints. `"docs"` — relaxed CSP for Scalar's reference UI.
	 */
	readonly scope?: "default" | "docs";
	/**
	 * Emit `Strict-Transport-Security` on every response. Wire this from
	 * `runtime.environment === "production"` at the app boundary —
	 * operators running over plaintext HTTP in development don't need
	 * (and shouldn't get) HSTS.
	 */
	readonly hsts?: boolean;
}

/**
 * Browser-facing hardening for the bundled SPA and API docs. Kept in
 * one middleware so tests can assert the runtime's default web posture
 * without coupling to individual routes. Pass `{ scope: "docs" }` for
 * the Scalar route only.
 *
 * No `Access-Control-Allow-Origin` header is set anywhere: the bundled
 * UI is same-origin with the API by design, and the runtime is not
 * meant to be called by third-party browser origins. Multi-origin
 * deployments must front the runtime with a reverse proxy that owns
 * the CORS contract — see `SECURITY.md`.
 */
export function securityHeaders(
	options: SecurityHeadersOptions = {},
): MiddlewareHandler<AppEnv> {
	const csp = options.scope === "docs" ? DOCS_CSP : DEFAULT_CSP;
	const hsts = options.hsts === true;
	return async (c, next) => {
		await next();
		c.header("Content-Security-Policy", csp);
		c.header("Cross-Origin-Opener-Policy", "same-origin");
		c.header("Referrer-Policy", "strict-origin-when-cross-origin");
		c.header("X-Content-Type-Options", "nosniff");
		c.header("X-Frame-Options", "DENY");
		c.header(
			"Permissions-Policy",
			"camera=(), geolocation=(), microphone=(), payment=(), usb=()",
		);
		if (hsts) {
			c.header("Strict-Transport-Security", HSTS_VALUE);
		}
	};
}
