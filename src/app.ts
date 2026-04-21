import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { ApiError, errorEnvelope } from "./lib/errors.js";
import { requestId } from "./lib/request-id.js";
import type { AppEnv } from "./lib/types.js";
import { operationalRoutes } from "./routes/operational.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { VERSION } from "./version.js";
import type { WorkspaceRegistry } from "./workspaces/registry.js";

export interface AppOptions {
	registry: WorkspaceRegistry;
	requestIdHeader?: string;
}

export function createApp(opts: AppOptions) {
	const app = new OpenAPIHono<AppEnv>();

	app.use("*", requestId(opts.requestIdHeader));

	app.route("/", operationalRoutes(opts.registry));
	app.route("/v1/workspaces", workspaceRoutes(opts.registry));

	app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
		type: "http",
		scheme: "bearer",
		description:
			"Per-workspace bearer token, matching one of the tokens declared under the workspace's auth.tokens in workbench.yaml.",
	});

	app.doc31("/v1/openapi.json", {
		openapi: "3.1.0",
		info: {
			title: "AI Workbench",
			version: VERSION,
			description:
				"Single-runtime, multi-workspace workbench for Astra DB and the Data API.",
			license: { name: "TBD" },
		},
		servers: [{ url: "/" }],
	});

	app.get(
		"/docs",
		Scalar({
			url: "/v1/openapi.json",
			theme: "default",
			pageTitle: "AI Workbench API",
		}),
	);

	app.notFound((c) =>
		c.json(
			errorEnvelope(
				c,
				"not_found",
				`Route ${c.req.method} ${c.req.path} not found`,
			),
			404,
		),
	);

	app.onError((err, c) => {
		if (err instanceof ApiError) {
			return c.json(errorEnvelope(c, err.code, err.message), err.status);
		}
		return c.json(
			errorEnvelope(
				c,
				"internal_error",
				err.message || "internal server error",
			),
			500,
		);
	});

	return app;
}
