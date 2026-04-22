import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type { AppEnv } from "../lib/types.js";
import {
	BannerSchema,
	HealthSchema,
	ReadySchema,
	VersionSchema,
} from "../openapi/schemas.js";
import { BUILD_TIME, COMMIT, VERSION } from "../version.js";

export function operationalRoutes(
	store: ControlPlaneStore,
): OpenAPIHono<AppEnv> {
	const app = new OpenAPIHono<AppEnv>();

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
			},
		}),
		async (c) => {
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

	return app;
}
