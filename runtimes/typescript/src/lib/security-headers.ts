import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./types.js";

const CSP = [
	"default-src 'self'",
	"base-uri 'self'",
	"connect-src 'self'",
	"font-src 'self' data:",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"img-src 'self' data:",
	"object-src 'none'",
	"script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
	"style-src 'self' 'unsafe-inline'",
].join("; ");

/**
 * Browser-facing hardening for the bundled SPA and API docs. Kept in
 * one middleware so tests can assert the runtime's default web posture
 * without coupling to individual routes.
 */
export function securityHeaders(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		await next();
		c.header("Content-Security-Policy", CSP);
		c.header("Cross-Origin-Opener-Policy", "same-origin");
		c.header("Referrer-Policy", "strict-origin-when-cross-origin");
		c.header("X-Content-Type-Options", "nosniff");
		c.header("X-Frame-Options", "DENY");
		c.header(
			"Permissions-Policy",
			"camera=(), geolocation=(), microphone=(), payment=(), usb=()",
		);
	};
}
