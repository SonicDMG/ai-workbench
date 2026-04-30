import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { AstraCliInfo } from "../config/astra-cli.js";
import type { McpConfig } from "../config/schema.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import { errorEnvelope } from "../lib/errors.js";
import { makeOpenApi } from "../lib/openapi.js";
import type { AppEnv } from "../lib/types.js";
import {
	AstraCliInfoSchema,
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
}

export function operationalRoutes(
	store: ControlPlaneStore,
	readiness?: ReadinessSignal,
	astraCli: AstraCliInfo | null = null,
	mcpConfig: McpConfig | null = null,
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
			return c.json(
				{ status: "ready" as const, workspaces: workspaces.length },
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

	app.openapi(
		createRoute({
			method: "get",
			path: "/features",
			tags: ["operational"],
			summary: "Runtime feature flags",
			description:
				"Read-only feature toggles the web UI uses to hide affordances that aren't wired up server-side (e.g. MCP). Mirrors the relevant `workbench.yaml` flags as resolved at startup.",
			responses: {
				200: {
					content: { "application/json": { schema: FeaturesSchema } },
					description: "Feature flag snapshot",
				},
			},
		}),
		(c) =>
			c.json(
				{
					mcp: { enabled: mcpConfig?.enabled === true },
				},
				200,
			),
	);

	return app;
}
