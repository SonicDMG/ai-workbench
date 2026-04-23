/**
 * Hono app factory — the default (TypeScript) AI Workbench green box.
 *
 * Mounts:
 *   `/`, `/healthz`, `/readyz`, `/version`        operational
 *   `/api/v1/workspaces`                          workspaces CRUD
 *   `/api/v1/workspaces/{w}/catalogs`             catalogs CRUD
 *   `/api/v1/workspaces/{w}/catalogs/{c}/documents`  document metadata CRUD
 *   `/api/v1/workspaces/{w}/vector-stores`        vector-store descriptor CRUD
 *   `/api/v1/openapi.json`                        generated OpenAPI doc
 *   `/docs`                                       Scalar-rendered docs
 */

import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { ForbiddenError, UnauthorizedError } from "./auth/errors.js";
import { authMiddleware } from "./auth/middleware.js";
import type { AuthResolver } from "./auth/resolver.js";
import type { ControlPlaneStore } from "./control-plane/store.js";
import type { VectorStoreDriverRegistry } from "./drivers/registry.js";
import { ApiError, errorEnvelope } from "./lib/errors.js";
import { makeOpenApi } from "./lib/openapi.js";
import { requestId } from "./lib/request-id.js";
import type { AppEnv } from "./lib/types.js";
import { apiKeyRoutes } from "./routes/api-v1/api-keys.js";
import { catalogRoutes } from "./routes/api-v1/catalogs.js";
import { documentRoutes } from "./routes/api-v1/documents.js";
import { mapControlPlaneError } from "./routes/api-v1/helpers.js";
import { vectorStoreRoutes } from "./routes/api-v1/vector-stores.js";
import { workspaceRoutes } from "./routes/api-v1/workspaces.js";
import { operationalRoutes } from "./routes/operational.js";
import type { SecretResolver } from "./secrets/provider.js";
import { isSpaPath, type UiAssets } from "./ui/assets.js";
import { VERSION } from "./version.js";

export interface AppOptions {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly secrets: SecretResolver;
	readonly auth: AuthResolver;
	readonly ui?: UiAssets | null;
	readonly requestIdHeader?: string;
}

export function createApp(opts: AppOptions): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.use("*", requestId(opts.requestIdHeader));

	// Static UI assets, when a dist/ is present. Runs before API
	// routes so favicons/CSS/JS resolve to disk; anything not found
	// calls next() and continues to the API/operational routes.
	// The SPA fallback is handled in `notFound` below so React
	// Router can take over for unknown non-API paths.
	if (opts.ui) {
		app.use("*", opts.ui.staticMiddleware);
	}

	// Auth scoped to the actual resource tree at /api/v1/workspaces/*.
	// Operational routes stay open (load balancers / ops), and so do
	// /api/v1/openapi.json + /docs — the machine-readable contract
	// and the human-facing reference UI must work even when strict
	// auth is on (docs says they bypass; the UI hardcodes the URL).
	app.use("/api/v1/workspaces/*", authMiddleware(opts.auth));

	app.route("/", operationalRoutes(opts.store));
	app.route(
		"/api/v1/workspaces",
		workspaceRoutes({ store: opts.store, secrets: opts.secrets }),
	);
	app.route("/api/v1/workspaces", catalogRoutes(opts.store));
	app.route("/api/v1/workspaces", documentRoutes(opts.store));
	app.route("/api/v1/workspaces", apiKeyRoutes(opts.store));
	app.route(
		"/api/v1/workspaces",
		vectorStoreRoutes({ store: opts.store, drivers: opts.drivers }),
	);

	app.doc31("/api/v1/openapi.json", {
		openapi: "3.1.0",
		info: {
			title: "AI Workbench",
			version: VERSION,
			description:
				"Single-runtime, multi-workspace workbench for Astra DB and the Data API. This is the TypeScript green box; alternative language runtimes expose the same surface.",
			license: { name: "TBD" },
		},
		servers: [{ url: "/" }],
	});

	app.get(
		"/docs",
		Scalar({
			url: "/api/v1/openapi.json",
			theme: "default",
			pageTitle: "AI Workbench API",
		}),
	);

	app.notFound((c) => {
		// SPA fallback: if the UI is mounted and this looks like a
		// client-side route (GET, HTML-accepting, not /api or /docs,
		// no file extension), serve index.html so the router can take
		// over. Everything else still gets the canonical JSON 404.
		if (
			opts.ui &&
			c.req.method === "GET" &&
			isSpaPath(c.req.path) &&
			(c.req.header("accept") ?? "").includes("text/html")
		) {
			return opts.ui.spaFallback(c);
		}
		return c.json(
			errorEnvelope(
				c,
				"not_found",
				`Route ${c.req.method} ${c.req.path} not found`,
			),
			404,
		);
	});

	app.onError((err, c) => {
		if (err instanceof UnauthorizedError) {
			c.header("WWW-Authenticate", err.scheme);
			return c.json(errorEnvelope(c, err.code, err.message), err.status);
		}
		if (err instanceof ForbiddenError) {
			return c.json(errorEnvelope(c, err.code, err.message), err.status);
		}
		const mapped = mapControlPlaneError(err);
		if (mapped) {
			return c.json(
				errorEnvelope(c, mapped.code, mapped.message),
				mapped.status,
			);
		}
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
