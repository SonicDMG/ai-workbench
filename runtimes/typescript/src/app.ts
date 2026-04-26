/**
 * Hono app factory — the default (TypeScript) AI Workbench green box.
 *
 * Mounts:
 *   `/`, `/healthz`, `/readyz`, `/version`        operational
 *   `/api/v1/workspaces`                          workspaces CRUD
 *   `/api/v1/workspaces/{w}/catalogs`             catalogs CRUD
 *   `/api/v1/workspaces/{w}/catalogs/{c}/documents`  document metadata CRUD
 *   `/api/v1/workspaces/{w}/catalogs/{c}/documents/search`  catalog-scoped search
 *   `/api/v1/workspaces/{w}/catalogs/{c}/ingest`  sync + async ingest
 *   `/api/v1/workspaces/{w}/jobs/{jobId}`         job poll + SSE
 *   `/api/v1/workspaces/{w}/catalogs/{c}/queries`  saved queries CRUD + /run
 *   `/api/v1/workspaces/{w}/vector-stores`        vector-store descriptor CRUD
 *   `/api/v1/openapi.json`                        generated OpenAPI doc
 *   `/docs`                                       Scalar-rendered docs
 */

import { randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { bodyLimit } from "hono/body-limit";
import { ForbiddenError, UnauthorizedError } from "./auth/errors.js";
import { authMiddleware } from "./auth/middleware.js";
import type { CookieSigner } from "./auth/oidc/login/cookie.js";
import type { OidcEndpoints } from "./auth/oidc/login/discovery.js";
import type { PendingLoginStore } from "./auth/oidc/login/pending.js";
import type { AuthResolver } from "./auth/resolver.js";
import type { AuthConfig } from "./config/schema.js";
import type { ControlPlaneStore } from "./control-plane/store.js";
import type { VectorStoreDriverRegistry } from "./drivers/registry.js";
import type { EmbedderFactory } from "./embeddings/factory.js";
import { MemoryJobStore } from "./jobs/memory-store.js";
import type { JobStore } from "./jobs/store.js";
import { ApiError, errorEnvelope } from "./lib/errors.js";
import { MAX_API_JSON_BODY_BYTES } from "./lib/limits.js";
import { logger } from "./lib/logger.js";
import { makeOpenApi } from "./lib/openapi.js";
import { requestId } from "./lib/request-id.js";
import { securityHeaders } from "./lib/security-headers.js";
import type { AppEnv } from "./lib/types.js";
import { apiKeyRoutes } from "./routes/api-v1/api-keys.js";
import { catalogRoutes } from "./routes/api-v1/catalogs.js";
import { documentRoutes } from "./routes/api-v1/documents.js";
import { mapControlPlaneError } from "./routes/api-v1/helpers.js";
import { jobRoutes } from "./routes/api-v1/jobs.js";
import { savedQueryRoutes } from "./routes/api-v1/saved-queries.js";
import { vectorStoreRoutes } from "./routes/api-v1/vector-stores.js";
import { workspaceRoutes } from "./routes/api-v1/workspaces.js";
import { authLoginRoutes } from "./routes/auth.js";
import type { ReadinessSignal } from "./routes/operational.js";
import { operationalRoutes } from "./routes/operational.js";
import type { SecretResolver } from "./secrets/provider.js";
import { isSpaPath, type UiAssets } from "./ui/assets.js";
import { VERSION } from "./version.js";

export interface AppLoginOptions {
	readonly authConfig: AuthConfig;
	readonly endpoints: OidcEndpoints | null;
	readonly clientSecret: string | null;
	readonly cookie: CookieSigner | null;
	readonly pending: PendingLoginStore | null;
}

export interface AppOptions {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly secrets: SecretResolver;
	readonly auth: AuthResolver;
	readonly embedders: EmbedderFactory;
	/** Optional — a {@link MemoryJobStore} is constructed if absent. */
	readonly jobs?: JobStore;
	readonly ui?: UiAssets | null;
	readonly login?: AppLoginOptions | null;
	readonly readiness?: ReadinessSignal;
	readonly requestIdHeader?: string;
	/** Identifier this replica writes into job leases. Defaults to a
	 * fresh `wb-<short-uuid>` per app instance — fine for single-
	 * replica deployments and tests; set explicitly for clustered
	 * runs so the orphan-sweeper can tell whose lease is whose. */
	readonly replicaId?: string;
}

export function createApp(opts: AppOptions): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();
	const jobsStore: JobStore = opts.jobs ?? new MemoryJobStore();
	const replicaId = opts.replicaId ?? generateReplicaId();

	app.use("*", requestId(opts.requestIdHeader));
	app.use("*", securityHeaders());
	app.use(
		"/api/v1/workspaces/*",
		bodyLimit({
			maxSize: MAX_API_JSON_BODY_BYTES,
			onError: (c) =>
				c.json(
					errorEnvelope(
						c,
						"payload_too_large",
						`request body must be <= ${MAX_API_JSON_BODY_BYTES} bytes`,
					),
					413,
				),
		}),
	);

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
	const cookieMiddlewareCfg =
		opts.login?.cookie && opts.login?.authConfig.oidc?.client
			? {
					name: opts.login.authConfig.oidc.client.sessionCookieName,
					signer: opts.login.cookie,
				}
			: null;
	app.use(
		"/api/v1/workspaces/*",
		authMiddleware({ resolver: opts.auth, cookie: cookieMiddlewareCfg }),
	);

	// The `/auth/me` endpoint also needs the auth context — run the
	// same middleware over it. Everything else under `/auth/*` is
	// unauthenticated (that's the whole point — they bootstrap auth).
	app.use(
		"/auth/me",
		authMiddleware({ resolver: opts.auth, cookie: cookieMiddlewareCfg }),
	);

	app.route("/", operationalRoutes(opts.store, opts.readiness));

	if (opts.login) {
		app.route(
			"/auth",
			authLoginRoutes({
				auth: opts.auth,
				config: opts.login.authConfig,
				endpoints: opts.login.endpoints,
				clientSecret: opts.login.clientSecret,
				cookie: opts.login.cookie,
				pending: opts.login.pending,
			}),
		);
	}
	app.route(
		"/api/v1/workspaces",
		workspaceRoutes({
			store: opts.store,
			secrets: opts.secrets,
			drivers: opts.drivers,
		}),
	);
	app.route("/api/v1/workspaces", catalogRoutes(opts.store));
	app.route(
		"/api/v1/workspaces",
		documentRoutes({
			store: opts.store,
			drivers: opts.drivers,
			embedders: opts.embedders,
			jobs: jobsStore,
			replicaId,
		}),
	);
	app.route("/api/v1/workspaces", jobRoutes({ jobs: jobsStore }));
	app.route(
		"/api/v1/workspaces",
		savedQueryRoutes({
			store: opts.store,
			drivers: opts.drivers,
			embedders: opts.embedders,
		}),
	);
	app.route("/api/v1/workspaces", apiKeyRoutes(opts.store));
	app.route(
		"/api/v1/workspaces",
		vectorStoreRoutes({
			store: opts.store,
			drivers: opts.drivers,
			embedders: opts.embedders,
		}),
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
		logger.error(
			{
				errName: err instanceof Error ? err.name : typeof err,
				requestId: c.get("requestId"),
			},
			"unhandled request error",
		);
		return c.json(
			errorEnvelope(c, "internal_error", "internal server error"),
			500,
		);
	});

	return app;
}

/**
 * Build a stable, greppable replica id for the lifetime of this app
 * instance. Format: `<host>-<rand8>` where `host` is the env's
 * `HOSTNAME` (set by Kubernetes from the pod name) or the literal
 * `wb` when unset, and `rand8` is the first 8 hex chars of a
 * fresh UUID. Tests typically pass an explicit `replicaId` and skip
 * this entirely.
 */
function generateReplicaId(): string {
	const host = process.env.HOSTNAME?.trim() || "wb";
	const rand = randomUUID().replace(/-/g, "").slice(0, 8);
	return `${host}-${rand}`;
}
