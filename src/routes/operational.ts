import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { errorEnvelope } from "../lib/errors.js";
import type { AppEnv } from "../lib/types.js";
import {
	BannerSchema,
	ErrorEnvelopeSchema,
	HealthSchema,
	ReadySchema,
	VersionSchema,
} from "../openapi/schemas.js";
import { BUILD_TIME, COMMIT, VERSION } from "../version.js";
import type { WorkspaceRegistry } from "../workspaces/registry.js";

export function operationalRoutes(registry: WorkspaceRegistry) {
	const app = new OpenAPIHono<AppEnv>();

	const bannerRoute = createRoute({
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
	});
	app.openapi(bannerRoute, (c) =>
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

	const healthRoute = createRoute({
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
	});
	app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

	const readyRoute = createRoute({
		method: "get",
		path: "/readyz",
		tags: ["operational"],
		summary: "Readiness probe",
		responses: {
			200: {
				content: { "application/json": { schema: ReadySchema } },
				description: "All workspaces resolved",
			},
			503: {
				content: { "application/json": { schema: ErrorEnvelopeSchema } },
				description: "One or more workspaces failed to initialize",
			},
		},
	});
	app.openapi(readyRoute, (c) => {
		if (registry.allReady()) {
			return c.json(
				{
					status: "ready" as const,
					workspaces: [...registry.ids()],
				},
				200,
			);
		}
		const [first] = registry.unready();
		const id = first?.config.id ?? "unknown";
		const reason = first?.error ?? "unknown error";
		return c.json(
			errorEnvelope(
				c,
				"workspace_unready",
				`Workspace '${id}' failed to initialize: ${reason}`,
			),
			503,
		);
	});

	const versionRoute = createRoute({
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
	});
	app.openapi(versionRoute, (c) =>
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

	return app;
}
