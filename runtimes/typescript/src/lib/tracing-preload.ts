/**
 * Tracing preload module — register the OpenTelemetry NodeSDK BEFORE
 * any instrumented module is loaded.
 *
 * For auto-instrumentations (`@opentelemetry/auto-instrumentations-node`)
 * to monkey-patch `http`, `fetch`, `pino`, etc., the SDK must be active
 * at the time those modules are first `require`d / `import`ed. With
 * Node.js ESM that means using `--import` at process launch:
 *
 *   node --import ./dist/lib/tracing-preload.js dist/root.js
 *
 * The exporter, sampler, and resource attributes follow the standard
 * `OTEL_*` env vars verbatim — set them on the process and they are
 * picked up automatically. Common ones:
 *
 *   OTEL_SERVICE_NAME=ai-workbench-runtime
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com
 *   OTEL_TRACES_SAMPLER=parentbased_traceidratio
 *   OTEL_TRACES_SAMPLER_ARG=0.1
 *
 * Without `--import`-time preloading, the runtime still creates manual
 * server spans through `lib/tracing.ts`'s `requestTracing` middleware
 * — auto-instrumented HTTP / fetch spans simply won't appear.
 */

import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
	resource: resourceFromAttributes({
		[ATTR_SERVICE_NAME]:
			process.env.OTEL_SERVICE_NAME ?? "ai-workbench-runtime",
		[ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? "0.0.0",
	}),
	traceExporter: new OTLPTraceExporter(),
	instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Best-effort flush on exit. The runtime's own `SIGINT`/`SIGTERM`
// handler also calls `sdk.shutdown()` for the in-process API; this
// hook covers process exits that bypass the graceful path.
const flush = () => {
	sdk.shutdown().catch((err: unknown) => {
		// Use stderr directly — the logger may already be shutting down.
		process.stderr.write(
			`opentelemetry preload shutdown failed: ${
				err instanceof Error ? err.message : String(err)
			}\n`,
		);
	});
};
process.on("SIGTERM", flush);
process.on("SIGINT", flush);
