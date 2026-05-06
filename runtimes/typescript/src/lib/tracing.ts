/**
 * OpenTelemetry tracing for the runtime.
 *
 * The model has two layers:
 *
 *   1. **Manual server spans** (always on). The Hono middleware
 *      `requestTracing` creates a CLIENT-context-aware SERVER span for
 *      every request, attaches `requestId` + the matched route as
 *      attributes, and records the final HTTP status / errors. When no
 *      SDK is registered, `@opentelemetry/api` returns no-op spans so
 *      this is essentially free — operator opt-in flips them on without
 *      a code change.
 *
 *   2. **NodeSDK + auto-instrumentation** (opt-in). Operators set
 *      `runtime.tracing.enabled: true` (or the `OTEL_*` env vars) and
 *      the runtime starts a `NodeSDK` with the OTLP HTTP trace exporter
 *      and the standard auto-instrumentations bundle. For
 *      auto-instrumentation to hook into HTTP / fetch / pino BEFORE
 *      they're imported, the SDK must be started at preload time —
 *      see the `tracing-preload.ts` module and the README in
 *      `docs/production.md` for the `node --import` invocation.
 *      `initOtelFromConfig` here also works for in-process startup —
 *      auto-instrumentation will only catch modules loaded after init,
 *      so manual spans are the safety net for everything else.
 *
 * The exporter and resource attributes follow the W3C / OTel standards
 * verbatim, so any OTel-compatible collector works (Honeycomb, Tempo,
 * Datadog, Grafana Cloud, …) without runtime changes.
 */

import {
	context as otelContext,
	propagation,
	type Span,
	SpanKind,
	SpanStatusCode,
	type Tracer,
	trace,
} from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";
import type { TracingConfig } from "../config/schema.js";
import { logger } from "./logger.js";
import type { AppEnv } from "./types.js";

const TRACER_NAME = "ai-workbench/runtime";

/**
 * Get the runtime's tracer. Returns a no-op tracer when no SDK is
 * registered, so callers don't need to null-check.
 */
export function getTracer(): Tracer {
	return trace.getTracer(TRACER_NAME);
}

/**
 * Hono middleware that wraps each request in a SERVER span. Pulls the
 * inbound W3C trace context off the headers via the OTel propagator
 * (so when an SDK is registered, this span links back to the caller's
 * trace) and falls through to a fresh root context otherwise.
 *
 * Attributes set:
 *   - `http.request.method`
 *   - `http.route`           (Hono's matched pattern, set after `next`)
 *   - `url.path`             (raw path)
 *   - `wb.request_id`        (ULID / inbound id from `requestId`
 *                              middleware — must run AFTER `requestId`)
 *   - `http.response.status_code` (after the handler returns)
 *
 * Errors thrown from inner middleware / handlers are recorded with
 * `recordException` + `setStatus(ERROR)` then re-thrown so the existing
 * `onError` mapping is unchanged.
 */
export function requestTracing(): MiddlewareHandler<AppEnv> {
	const tracer = getTracer();
	return async (c, next) => {
		const carrier: Record<string, string> = {};
		c.req.raw.headers.forEach((v, k) => {
			carrier[k] = v;
		});
		// Pull the inbound W3C trace context off the request headers.
		// When no SDK is registered, the active context is the root and
		// the extract is effectively a no-op.
		const parent = propagation.extract(otelContext.active(), carrier);
		const spanName = `${c.req.method} ${c.req.path}`;
		// Pass the parent context as the third arg so the new span is
		// properly parented. `setSpan(parent, span)` then becomes the
		// active context for the duration of the request so downstream
		// `trace.getActiveSpan()` calls (or auto-instrumented child
		// spans) correctly attach.
		const span = tracer.startSpan(spanName, { kind: SpanKind.SERVER }, parent);
		const ctx = trace.setSpan(parent, span);

		await otelContext.with(ctx, async () => {
			try {
				setRequestAttributes(span, c.req.method, c.req.path);
				const requestId = c.get("requestId");
				if (requestId) span.setAttribute("wb.request_id", requestId);

				await next();

				// Hono's error handler runs inside `next()` and stashes
				// the original error on `c.error`. Read it back so we
				// can record the exception on the span without altering
				// the response flow.
				if (c.error instanceof Error) {
					span.recordException(c.error);
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: c.error.message,
					});
				}

				// `routePath` is set by Hono after pattern-matching;
				// use it as the low-cardinality `http.route` per OTel
				// semantic conventions. Falls back to the raw path so
				// 404s still get an attribute.
				const matched = c.req.routePath ?? c.req.path;
				span.setAttribute("http.route", matched);
				span.setAttribute("http.response.status_code", c.res.status);
				if (c.res.status >= 500 && !c.error) {
					span.setStatus({ code: SpanStatusCode.ERROR });
				}
			} catch (err) {
				// Errors that escape Hono's onError handler. Rare; record
				// and re-throw so the surrounding stack still sees them.
				if (err instanceof Error) {
					span.recordException(err);
				}
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: err instanceof Error ? err.message : String(err),
				});
				throw err;
			} finally {
				span.end();
			}
		});
	};
}

function setRequestAttributes(span: Span, method: string, path: string): void {
	span.setAttribute("http.request.method", method);
	span.setAttribute("url.path", path);
}

/**
 * Result of `initOtelFromConfig`. The caller stores the returned
 * `shutdown` and invokes it during graceful drain so in-flight spans
 * are flushed before the process exits.
 */
export interface OtelHandle {
	readonly shutdown: () => Promise<void>;
}

/**
 * Conditionally start a NodeSDK with the OTLP HTTP trace exporter +
 * standard auto-instrumentations. Returns `null` when tracing is
 * disabled (no SDK registered → all spans are no-ops).
 *
 * Configuration precedence:
 *   - `runtime.tracing.enabled: false` → unconditionally off.
 *   - `runtime.tracing.enabled: true` → on; service-name / endpoint /
 *      headers come from `runtime.tracing.*` if set, otherwise from
 *      the standard `OTEL_*` env vars.
 *
 * The SDK is dynamically imported so deployments that never enable
 * tracing don't pay its load cost.
 */
export async function initOtelFromConfig(
	cfg: TracingConfig | null,
): Promise<OtelHandle | null> {
	if (!cfg?.enabled) return null;

	try {
		// Lazy-load the heavy SDK bundle. Disabled deployments don't
		// pay this cost.
		const { NodeSDK } = await import("@opentelemetry/sdk-node");
		const { getNodeAutoInstrumentations } = await import(
			"@opentelemetry/auto-instrumentations-node"
		);
		const { OTLPTraceExporter } = await import(
			"@opentelemetry/exporter-trace-otlp-http"
		);
		const { resourceFromAttributes } = await import("@opentelemetry/resources");
		const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
			"@opentelemetry/semantic-conventions"
		);

		const serviceName = cfg.serviceName ?? "ai-workbench-runtime";
		const exporterUrl = cfg.exporterUrl ?? undefined; // SDK falls back to OTEL_EXPORTER_OTLP_ENDPOINT / default

		const sdk = new NodeSDK({
			resource: resourceFromAttributes({
				[ATTR_SERVICE_NAME]: serviceName,
				[ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? "0.0.0",
			}),
			traceExporter: new OTLPTraceExporter({ url: exporterUrl }),
			instrumentations: [getNodeAutoInstrumentations()],
		});
		sdk.start();
		logger.info(
			{ serviceName, exporterUrl: exporterUrl ?? "<env>" },
			"opentelemetry tracing enabled",
		);

		return {
			shutdown: async () => {
				try {
					await sdk.shutdown();
				} catch (err) {
					logger.warn({ err }, "opentelemetry sdk shutdown failed");
				}
			},
		};
	} catch (err) {
		// Tracing is best-effort; an SDK failure must never break the
		// runtime. Log loudly and continue with no-op spans.
		logger.error({ err }, "opentelemetry sdk init failed; tracing disabled");
		return null;
	}
}
