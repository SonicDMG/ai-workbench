/**
 * Runtime-wide metrics registry — the singleton instance that the HTTP
 * middleware, rate-limiter, and ingest semaphore all push observations
 * to. Exposed at `GET /metrics` in Prometheus text format.
 *
 * Shape rules:
 *   - Path label is the **route pattern** (`/api/v1/workspaces/:workspaceId`),
 *     not the literal request path. Hono's `c.req.routePath` gives us
 *     this; falling back to `<unmatched>` for paths that didn't match a
 *     mounted route (404 surface).
 *   - Status is the bucketed family (`2xx`, `4xx`, `5xx`) rather than
 *     the literal status. Cuts label cardinality by ~5x without losing
 *     the alerting signal.
 */

import type { Context, MiddlewareHandler } from "hono";
import {
	Counter,
	DEFAULT_HTTP_BUCKETS_SECONDS,
	Gauge,
	Histogram,
	MetricsRegistry,
} from "./metrics.js";
import type { AppEnv } from "./types.js";

export interface RuntimeMetrics {
	readonly registry: MetricsRegistry;
	readonly httpRequests: Counter;
	readonly httpRequestDuration: Histogram;
	readonly rateLimitRejections: Counter;
	readonly ingestActive: Gauge;
	readonly ingestQueued: Gauge;
	/**
	 * `workbench_chat_requests_total{provider, outcome}` —
	 *   provider ∈ { openrouter, openai, ollama, fixture, … } (low cardinality;
	 *     matches `ChatService.providerId`).
	 *   outcome ∈ { stop, length, tool_calls, error }.
	 */
	readonly chatRequests: Counter;
	/**
	 * `workbench_chat_stream_tokens_total{direction}` —
	 *   direction ∈ { in, out }. `in` is request prompt tokens reported
	 *   by the provider (when available); `out` is emitted tokens.
	 */
	readonly chatStreamTokens: Counter;
	/**
	 * `workbench_ingest_documents_total{outcome}` —
	 *   outcome ∈ { ok, failed, skipped }. KB id is intentionally NOT a
	 *   label — workspaces with thousands of KBs would blow up the
	 *   cardinality; per-KB rollups live in the application DB.
	 */
	readonly ingestDocuments: Counter;
	/**
	 * `workbench_search_requests_total{mode, outcome}` —
	 *   mode ∈ { vector, hybrid, vector_rerank, hybrid_rerank }.
	 *   outcome ∈ { ok, error }.
	 */
	readonly searchRequests: Counter;
	/**
	 * `workbench_search_duration_seconds{mode}` — server-side wall-clock
	 * latency for the dispatched search.
	 */
	readonly searchDuration: Histogram;
}

export function buildRuntimeMetrics(): RuntimeMetrics {
	const registry = new MetricsRegistry();
	const httpRequests = registry.register(
		new Counter(
			"workbench_http_requests_total",
			"HTTP request count, labeled by method, route pattern, and status family.",
		),
	);
	const httpRequestDuration = registry.register(
		new Histogram(
			"workbench_http_request_duration_seconds",
			"HTTP request duration in seconds, labeled by method, route pattern, and status family.",
			DEFAULT_HTTP_BUCKETS_SECONDS,
		),
	);
	const rateLimitRejections = registry.register(
		new Counter(
			"workbench_rate_limit_rejections_total",
			"Requests rejected by the in-process rate limiter.",
		),
	);
	const ingestActive = registry.register(
		new Gauge(
			"workbench_ingest_workers_active",
			"Number of in-flight ingest workers on this replica.",
		),
	);
	const ingestQueued = registry.register(
		new Gauge(
			"workbench_ingest_workers_queued",
			"Number of ingest workers waiting on the concurrency cap.",
		),
	);
	const chatRequests = registry.register(
		new Counter(
			"workbench_chat_requests_total",
			"Chat completion requests, labeled by provider and outcome.",
		),
	);
	const chatStreamTokens = registry.register(
		new Counter(
			"workbench_chat_stream_tokens_total",
			"Tokens emitted by chat completions, by direction (in / out).",
		),
	);
	const ingestDocuments = registry.register(
		new Counter(
			"workbench_ingest_documents_total",
			"Documents processed by the ingest worker, labeled by outcome.",
		),
	);
	const searchRequests = registry.register(
		new Counter(
			"workbench_search_requests_total",
			"Knowledge-base search requests, labeled by mode and outcome.",
		),
	);
	const searchDuration = registry.register(
		new Histogram(
			"workbench_search_duration_seconds",
			"Wall-clock duration of dispatched search calls, labeled by mode.",
			DEFAULT_HTTP_BUCKETS_SECONDS,
		),
	);
	return {
		registry,
		httpRequests,
		httpRequestDuration,
		rateLimitRejections,
		ingestActive,
		ingestQueued,
		chatRequests,
		chatStreamTokens,
		ingestDocuments,
		searchRequests,
		searchDuration,
	};
}

/**
 * Maps an HTTP status to its family label. Keeps the cardinality of
 * the status label bounded at 4 — `2xx`, `3xx`, `4xx`, `5xx` — so a
 * burst of distinct error codes doesn't blow up the metric set.
 */
export function statusFamily(status: number): string {
	if (status >= 500) return "5xx";
	if (status >= 400) return "4xx";
	if (status >= 300) return "3xx";
	if (status >= 200) return "2xx";
	return "1xx";
}

/**
 * Resolve a low-cardinality route label from the Hono context. Prefers
 * the matched route pattern (`/api/v1/workspaces/:workspaceId`) over
 * the literal path so workspace IDs don't explode the label space.
 *
 * Falls back to `<unmatched>` when no route matched (404 surface) so
 * the metric line still renders without unbounded growth.
 */
export function routeLabel(c: Context<AppEnv>): string {
	// Hono attaches `c.req.routePath` once a route handler matches.
	const routePath = c.req.routePath;
	if (routePath && routePath !== "/*" && routePath !== "*") {
		return routePath;
	}
	return "<unmatched>";
}

/**
 * Hono middleware that records one observation per request. Run it
 * AFTER the request-id + body-limit middleware so the route is
 * resolved by the time we read `routePath` — but BEFORE auth so
 * 401/403 still get attributed to a route pattern instead of falling
 * through as `<unmatched>`.
 */
export function requestMetrics(
	metrics: RuntimeMetrics,
): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const start = process.hrtime.bigint();
		try {
			await next();
		} finally {
			const end = process.hrtime.bigint();
			const durationSeconds = Number(end - start) / 1e9;
			const labels = {
				method: c.req.method,
				route: routeLabel(c),
				status: statusFamily(c.res.status),
			};
			metrics.httpRequests.inc(labels);
			metrics.httpRequestDuration.observe(labels, durationSeconds);
		}
	};
}
