import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { ChatService } from "../chat/types.js";
import {
	type AstraCliInfo,
	type AstraCliInventory,
	discoverAstraCliInventory,
} from "../config/astra-cli.js";
import type { McpConfig } from "../config/schema.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import { listErrorCodes } from "../lib/error-codes.js";
import { errorEnvelope } from "../lib/errors.js";
import { probeChatProvider, probeControlPlane } from "../lib/health-probes.js";
import { makeOpenApi } from "../lib/openapi.js";
import { resolvePublicBaseUrl } from "../lib/public-url.js";
import type { RecentErrorBuffer } from "../lib/recent-errors.js";
import type { RuntimeMetrics } from "../lib/runtime-metrics.js";
import type { AppEnv } from "../lib/types.js";
import {
	AstraCliInfoSchema,
	AstraCliInventorySchema,
	BannerSchema,
	ErrorEnvelopeSchema,
	FeaturesSchema,
	HealthSchema,
	ReadySchema,
	VersionSchema,
} from "../openapi/schemas.js";
import { BUILD_TIME, COMMIT, VERSION } from "../version.js";

/**
 * Opt-in drain signal. `root.ts` flips `draining` on SIGINT/SIGTERM
 * so `/readyz` reports 503 during graceful-shutdown drain even
 * though new connections are still being accepted. Load balancers
 * with a readiness probe will route traffic away without us having
 * to slam the port closed mid-request.
 */
export interface ReadinessSignal {
	draining: boolean;
	/**
	 * Aborts when the runtime begins shutting down. Long-lived SSE streams
	 * (the job-events stream) observe it and end promptly: closing the
	 * connection lets the client's EventSource reconnect to a surviving
	 * replica and resume via `Last-Event-ID`, and lets `server.close()`
	 * finish instead of waiting out the drain timeout on a stream that
	 * would otherwise stay open for the life of a running job.
	 */
	readonly shutdownSignal?: AbortSignal;
}

export function operationalRoutes(
	store: ControlPlaneStore,
	readiness?: ReadinessSignal,
	astraCli: AstraCliInfo | null = null,
	mcpConfig: McpConfig | null = null,
	// Test seam — defaults to the real CLI shellout. Tests inject a fake
	// to avoid depending on whether `astra` is on the runner's PATH.
	inventoryFn: () => AstraCliInventory = discoverAstraCliInventory,
	// Optional ingest semaphore — when present, /readyz surfaces its
	// stats so an LB can see "running but saturated" at a glance. When
	// absent, the stats field is omitted from the response.
	ingestSemaphore?: import("../jobs/ingest-semaphore.js").IngestSemaphore,
	// Optional metrics registry — when present, exposes a Prometheus
	// `/metrics` endpoint. Absent in tests that don't care about the
	// metrics surface, so the registry stays out of pin-style snapshots.
	metrics?: RuntimeMetrics,
	// Optional chat service — when present, `/health/details` probes it
	// alongside the control plane. Tests usually leave this null.
	chatService: ChatService | null = null,
	// Optional ring buffer of recent error envelopes — when present,
	// `/health/recent-errors` returns the snapshot. App-side wiring in
	// `app.ts` feeds it from the `onError` handler.
	recentErrors?: RecentErrorBuffer,
): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/",
			tags: ["operational"],
			summary: "Service banner",
			responses: {
				200: {
					content: { "application/json": { schema: BannerSchema } },
					description: "Service metadata",
				},
			},
		}),
		(c) =>
			c.json(
				{
					name: "ai-workbench",
					version: VERSION,
					commit: COMMIT,
					docs: "/docs",
				},
				200,
			),
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/healthz",
			tags: ["operational"],
			summary: "Liveness probe",
			responses: {
				200: {
					content: { "application/json": { schema: HealthSchema } },
					description: "Service is alive",
				},
			},
		}),
		(c) => c.json({ status: "ok" as const }, 200),
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/readyz",
			tags: ["operational"],
			summary: "Readiness probe",
			responses: {
				200: {
					content: { "application/json": { schema: ReadySchema } },
					description: "Control plane is reachable",
				},
				503: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"Not ready — either the process is draining on shutdown or the control plane is unreachable",
				},
			},
		}),
		async (c) => {
			if (readiness?.draining) {
				return c.json(
					errorEnvelope(
						c,
						"draining",
						"runtime is shutting down; traffic should be routed elsewhere",
					),
					503,
				);
			}
			const workspaces = await store.listWorkspaces();
			const ingest = ingestSemaphore?.stats();
			return c.json(
				{
					status: "ready" as const,
					workspaces: workspaces.length,
					...(ingest ? { ingest } : {}),
				},
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/astra-cli",
			tags: ["operational"],
			summary: "astra-cli auto-detection status",
			description:
				"Reports whether the runtime resolved an Astra database from a configured `astra` CLI profile at startup, and if so which one. Tokens are never exposed. The web UI uses this to suggest defaults in the workspace onboarding form.",
			responses: {
				200: {
					content: { "application/json": { schema: AstraCliInfoSchema } },
					description: "astra-cli detection status",
				},
			},
		}),
		(c) => {
			const body: AstraCliInfo = astraCli ?? {
				detected: false,
				reason: "binary-not-found",
			};
			return c.json(body, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/astra-cli/profiles",
			tags: ["operational"],
			summary: "astra-cli inventory (profiles + their databases)",
			description:
				"Lists every configured `astra` CLI profile along with the databases each can see. Tokens are never exposed. The web UI uses this to drive a profile + database picker in workspace onboarding so the user can choose a target without restarting the runtime with `ASTRA_PROFILE=…`. Workspaces created from the picker get a `credentialsRef` of the form `astra-cli:<profile>:<dbId>:<token|endpoint>` which resolves on demand at use-time.",
			responses: {
				200: {
					content: { "application/json": { schema: AstraCliInventorySchema } },
					description: "astra-cli inventory or a degraded-state envelope",
				},
			},
		}),
		(c) => {
			const inventory: AstraCliInventory = inventoryFn();
			return c.json(inventory, 200);
		},
	);

	// `GET /metrics` — Prometheus text exposition. The route is
	// mounted unconditionally for OpenAPI shape stability, but emits a
	// single-line "metrics not enabled" body when no registry was
	// supplied. Production deploys always wire one through.
	app.get("/metrics", (c) => {
		if (!metrics) {
			return c.text(
				"# metrics endpoint is mounted but no registry is wired into operationalRoutes — pass `metrics` from createApp to enable\n",
				200,
				{ "content-type": "text/plain; version=0.0.4; charset=utf-8" },
			);
		}
		// Pull the live ingest stats into their gauges before rendering
		// so a scrape sees the current state, not the most-recent push.
		if (ingestSemaphore) {
			const stats = ingestSemaphore.stats();
			metrics.ingestActive.set({}, stats.active);
			metrics.ingestQueued.set({}, stats.queued);
		}
		return c.text(metrics.registry.render(), 200, {
			"content-type": "text/plain; version=0.0.4; charset=utf-8",
		});
	});

	app.openapi(
		createRoute({
			method: "get",
			path: "/version",
			tags: ["operational"],
			summary: "Build metadata",
			responses: {
				200: {
					content: { "application/json": { schema: VersionSchema } },
					description: "Version, commit, build time, node version",
				},
			},
		}),
		(c) =>
			c.json(
				{
					version: VERSION,
					commit: COMMIT,
					buildTime: BUILD_TIME,
					node: process.version,
				},
				200,
			),
	);

	app.get("/error-codes", (c) =>
		c.json(
			{
				codes: listErrorCodes().map((entry) => ({
					code: entry.code,
					defaultStatus: entry.defaultStatus,
					hint: entry.hint,
					docs: `docs/errors.md#${entry.docsAnchor}`,
				})),
			},
			200,
		),
	);

	app.get("/health/details", async (c) => {
		const [controlPlane, chat] = await Promise.all([
			probeControlPlane(store),
			probeChatProvider(chatService),
		]);
		const ingest = ingestSemaphore ? ingestSemaphore.stats() : null;
		return c.json(
			{
				controlPlane,
				chat,
				ingest,
				recentErrors: {
					capacity: recentErrors?.capacity ?? 0,
					count: recentErrors?.snapshot().length ?? 0,
				},
			},
			200,
		);
	});

	app.get("/health/recent-errors", (c) =>
		c.json(
			{
				capacity: recentErrors?.capacity ?? 0,
				entries: recentErrors?.snapshot() ?? [],
			},
			200,
		),
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/features",
			tags: ["operational"],
			summary: "Runtime feature flags",
			description:
				"Read-only feature toggles + reachable URLs the web UI uses to surface affordances that aren't safely derivable client-side (e.g. the MCP endpoint when the UI is served behind a dev-server proxy or a TLS-terminating load balancer).",
			responses: {
				200: {
					content: { "application/json": { schema: FeaturesSchema } },
					description: "Feature flag + URL snapshot",
				},
			},
		}),
		(c) => {
			const enabled = mcpConfig?.enabled === true;
			return c.json(
				{
					mcp: {
						enabled,
						baseUrl: enabled ? resolvePublicBaseUrl(c.req.raw) : null,
					},
				},
				200,
			);
		},
	);

	return app;
}
