import type { MiddlewareHandler } from "hono";
import type { Logger } from "./logger.js";
import type { AppEnv } from "./types.js";

/**
 * Per-request access log. Emits one structured `info` line per response
 * with `{ requestId, method, path, status, durationMs, contentLength }`
 * so operators can build dashboards on traffic volume, error rate, and
 * latency p99 without grepping free-form log text.
 *
 * Skips the noisier polling routes (`/healthz`, `/readyz`,
 * `/api/v1/openapi.json`, static UI assets) at the `debug` level so a
 * default-info logger isn't drowned by liveness probes.
 */
const QUIET_PATHS = new Set(["/healthz", "/readyz", "/api/v1/openapi.json"]);

function isQuiet(path: string): boolean {
	if (QUIET_PATHS.has(path)) return true;
	// Static UI bundle (`/assets/*`, `/favicon.ico`, etc.) — anything
	// that's clearly not an API or auth route. The auth + api routes
	// always start with their respective prefixes, so logging non-API
	// `GET`s at debug is enough for normal ops.
	if (path === "/" || path.startsWith("/assets/")) return true;
	return false;
}

export function requestLogger(logger: Logger): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const start = process.hrtime.bigint();
		const { method } = c.req;
		const path = c.req.path;
		try {
			await next();
		} finally {
			const end = process.hrtime.bigint();
			const durationMs = Number(end - start) / 1_000_000;
			const requestId = c.get("requestId");
			const status = c.res.status;
			const contentLengthHeader = c.res.headers.get("content-length");
			const contentLength =
				contentLengthHeader !== null
					? Number.parseInt(contentLengthHeader, 10)
					: null;
			const fields = {
				requestId,
				method,
				path,
				status,
				durationMs: Number(durationMs.toFixed(2)),
				contentLength,
			};
			const level = isQuiet(path) ? "debug" : status >= 500 ? "error" : "info";
			logger[level](fields, "request");
		}
	};
}
