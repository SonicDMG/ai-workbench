/**
 * Hono app factory — the default (TypeScript) AI Workbench green box.
 *
 * Mounts:
 *   `/`, `/healthz`, `/readyz`, `/version`                            operational
 *   `/api/v1/workspaces`                                              workspaces CRUD
 *   `/api/v1/workspaces/{w}/knowledge-bases`                          KB CRUD
 *   `/api/v1/workspaces/{w}/knowledge-bases/{kb}/documents`           document CRUD
 *   `/api/v1/workspaces/{w}/knowledge-bases/{kb}/documents/{d}/chunks` chunk listing
 *   `/api/v1/workspaces/{w}/knowledge-bases/{kb}/ingest`              sync + async ingest
 *   `/api/v1/workspaces/{w}/knowledge-bases/{kb}/records`             upsert
 *   `/api/v1/workspaces/{w}/knowledge-bases/{kb}/records/{id}`        delete record
 *   `/api/v1/workspaces/{w}/knowledge-bases/{kb}/search`              vector / hybrid / rerank
 *   `/api/v1/workspaces/{w}/{chunking,embedding,reranking,llm}-services`  service CRUD
 *   `/api/v1/workspaces/{w}/jobs/{jobId}`                             job poll + SSE
 *   `/api/v1/workspaces/{w}/agents`                                   user-defined agent CRUD
 *   `/api/v1/workspaces/{w}/agents/{a}/conversations`                 conversation CRUD per agent
 *   `/api/v1/openapi.json`                                            generated OpenAPI doc
 *   `/docs`                                                           Scalar-rendered docs
 */

import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { bodyLimit } from "hono/body-limit";
import { workspaceRouteAuthz } from "./auth/authz.js";
import { ForbiddenError, UnauthorizedError } from "./auth/errors.js";
import { authMiddleware } from "./auth/middleware.js";
import type { CookieSigner } from "./auth/oidc/login/cookie.js";
import type { OidcEndpoints } from "./auth/oidc/login/discovery.js";
import type { PendingLoginStore } from "./auth/oidc/login/pending.js";
import type { AuthResolver } from "./auth/resolver.js";
import type { ChatService } from "./chat/types.js";
import type { AstraCliInfo } from "./config/astra-cli.js";
import type { AuthConfig, ChatConfig, McpConfig } from "./config/schema.js";
import type { ControlPlaneStore } from "./control-plane/store.js";
import type { VectorStoreDriverRegistry } from "./drivers/registry.js";
import type { EmbedderFactory } from "./embeddings/factory.js";
import { MemoryJobStore } from "./jobs/memory-store.js";
import type { JobStore } from "./jobs/store.js";
import { ApiError, errorEnvelope } from "./lib/errors.js";
import { MAX_API_JSON_BODY_BYTES } from "./lib/limits.js";
import { logger } from "./lib/logger.js";
import { makeOpenApi } from "./lib/openapi.js";
import { rateLimit } from "./lib/rate-limit.js";
import { generateReplicaId } from "./lib/replica-id.js";
import { requestId } from "./lib/request-id.js";
import { SCALAR_CDN_PINNED, securityHeaders } from "./lib/security-headers.js";
import type { AppEnv } from "./lib/types.js";
import { buildDefaultRoutePlugins } from "./plugins/default-plugins.js";
import type { RoutePluginRegistry } from "./plugins/registry.js";
import { mapControlPlaneError } from "./routes/api-v1/helpers.js";
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
	readonly publicOrigin: string | null;
	readonly trustProxyHeaders: boolean;
}

export interface RateLimitOptions {
	/** Toggle the in-process limiter. Defaults to `true`. */
	readonly enabled?: boolean;
	/** Max requests per window per client key (IP). */
	readonly capacity: number;
	/** Window length in milliseconds. */
	readonly windowMs: number;
	/**
	 * Honor `X-Forwarded-For` / `X-Real-IP` when computing the client
	 * key. Mirror this from `runtime.trustProxyHeaders`.
	 */
	readonly trustProxyHeaders?: boolean;
}

export interface AppOptions {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly secrets: SecretResolver;
	readonly auth: AuthResolver;
	readonly embedders: EmbedderFactory;
	/**
	 * Mirrors `runtime.environment` from `workbench.yaml`. Drives
	 * production-only browser hardening — currently the
	 * `Strict-Transport-Security` header. Defaults to `"development"`
	 * so tests get the dev posture out of the box.
	 */
	readonly environment?: "development" | "production";
	/** Optional — a {@link MemoryJobStore} is constructed if absent. */
	readonly jobs?: JobStore;
	readonly ui?: UiAssets | null;
	readonly login?: AppLoginOptions | null;
	readonly readiness?: ReadinessSignal;
	readonly requestIdHeader?: string;
	/**
	 * In-process rate limiter applied to `/api/v1/*` and `/auth/*`.
	 * Defaults are conservative (600 req/min/IP for API, 30 req/min/IP
	 * for auth); set `enabled: false` to disable, or override capacity
	 * for high-throughput tenants. Distributed deployments should
	 * still front the runtime with a network-level limiter.
	 */
	readonly rateLimit?: RateLimitOptions | null;
	/** Identifier this replica writes into job leases. Defaults to a
	 * fresh `wb-<short-uuid>` per app instance — fine for single-
	 * replica deployments and tests; set explicitly for clustered
	 * runs so the orphan-sweeper can tell whose lease is whose. */
	readonly replicaId?: string;
	/**
	 * Result of the optional `astra-cli` auto-detection that runs
	 * during startup, exposed verbatim on `GET /astra-cli`. The web UI
	 * reads this to suggest defaults in the workspace onboarding form.
	 * `null` means the detection step never ran (e.g. tests).
	 */
	readonly astraCli?: AstraCliInfo | null;
	/**
	 * Chat-completion service used by the agent send / stream surface
	 * (`/api/v1/workspaces/{w}/agents/{a}/conversations/{c}/messages`).
	 * `null` (or undefined) means the runtime was booted without a
	 * `chat` block in `workbench.yaml`; agent send routes return
	 * `503 chat_disabled`.
	 */
	readonly chatService?: ChatService | null;
	/** Mirrors the parsed `chat` config block; needed for retrieval defaults. */
	readonly chatConfig?: ChatConfig | null;
	/**
	 * Model Context Protocol surface configuration. When omitted /
	 * `enabled: false`, the MCP route returns 404. See
	 * [`docs/mcp.md`](../../../docs/mcp.md).
	 */
	readonly mcpConfig?: McpConfig;
	/**
	 * Optional override for the workspace-scoped route plugins. Defaults
	 * to {@link buildDefaultRoutePlugins} which mounts the in-tree
	 * routes. Tests can pass a smaller registry to exercise a subset;
	 * future external plugins register via this hook.
	 */
	readonly routePlugins?: RoutePluginRegistry;
}

const DEFAULT_API_RATE_LIMIT: Required<
	Omit<RateLimitOptions, "trustProxyHeaders" | "enabled">
> = {
	capacity: 600,
	windowMs: 60_000,
};

const DEFAULT_AUTH_RATE_LIMIT_CAPACITY = 30;

const OPENAPI_CONFIG = {
	openapi: "3.1.0",
	info: {
		title: "AI Workbench",
		version: VERSION,
		description:
			"Single-runtime, multi-workspace workbench for Astra DB and the Data API. This is the TypeScript green box; alternative language runtimes expose the same surface.",
		license: {
			name: "MIT",
			url: "https://opensource.org/license/mit",
		},
	},
	servers: [{ url: "/" }],
};

const COMMON_API_ERROR_RESPONSES = {
	400: "BadRequest",
	401: "Unauthorized",
	403: "Forbidden",
	409: "Conflict",
	422: "UnprocessableEntity",
	429: "TooManyRequests",
	500: "InternalServerError",
} as const;

export function createApp(opts: AppOptions): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();
	const jobsStore: JobStore = opts.jobs ?? new MemoryJobStore();
	const replicaId = opts.replicaId ?? generateReplicaId();

	app.use("*", requestId(opts.requestIdHeader));
	// HSTS is a deployment posture, not a default: only emit it when the
	// operator has declared this is a production runtime. Plaintext-HTTP
	// dev servers don't benefit, and stale HSTS pins are painful to
	// recover from.
	const hsts = opts.environment === "production";
	// Loosen the CSP for the Scalar `/docs` page only — see
	// `lib/security-headers.ts` for the rationale (Scalar emits an
	// inline bootstrap script and loads its bundle from a pinned CDN).
	// Register BEFORE the wildcard default so the docs middleware
	// is the outer wrapper: Hono runs post-`next()` writes outer→last,
	// so the outer handler's `c.header(...)` wins on overlapping paths.
	app.use("/docs", securityHeaders({ scope: "docs", hsts }));
	app.use("/docs/*", securityHeaders({ scope: "docs", hsts }));
	app.use("*", securityHeaders({ hsts }));

	const rateLimitCfg = opts.rateLimit;
	const rateLimitEnabled = rateLimitCfg?.enabled !== false;
	if (rateLimitEnabled) {
		const apiCapacity =
			rateLimitCfg?.capacity ?? DEFAULT_API_RATE_LIMIT.capacity;
		const apiWindowMs =
			rateLimitCfg?.windowMs ?? DEFAULT_API_RATE_LIMIT.windowMs;
		const trustProxyHeaders = rateLimitCfg?.trustProxyHeaders ?? false;
		// API surface: generous default (600/min) keeps normal clients
		// nowhere near the limit while still throttling runaway loops
		// and brute-force scans.
		app.use(
			"/api/v1/*",
			rateLimit({
				capacity: apiCapacity,
				windowMs: apiWindowMs,
				trustProxyHeaders,
			}),
		);
		// Auth flows get a tighter limit — login attempts, callback
		// reentries, and `/auth/me` probes shouldn't burst.
		app.use(
			"/auth/*",
			rateLimit({
				capacity: DEFAULT_AUTH_RATE_LIMIT_CAPACITY,
				windowMs: apiWindowMs,
				trustProxyHeaders,
			}),
		);
	}

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

	// Workspace authorization is centralized here so every current and
	// future workspace-scoped route inherits the same check. List/create
	// stay outside this wrapper: list filters by scopes, and create uses
	// `assertPlatformAccess` in the handler because it has no target
	// workspace ID yet.
	const workspaceAuthz = workspaceRouteAuthz();
	app.use("/api/v1/workspaces/:workspaceId", workspaceAuthz);
	app.use("/api/v1/workspaces/:workspaceId/*", workspaceAuthz);

	app.route(
		"/",
		operationalRoutes(
			opts.store,
			opts.readiness,
			opts.astraCli ?? null,
			opts.mcpConfig ?? null,
		),
	);

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
				publicOrigin: opts.login.publicOrigin,
				trustProxyHeaders: opts.login.trustProxyHeaders,
			}),
		);
	}
	// Workspace-scoped routes are mounted through the route-plugin
	// registry. `buildDefaultRoutePlugins` returns the in-tree set
	// (workspaces, KB, agents, services, jobs, MCP, …); tests can pass
	// `routePlugins` to override or trim it. See
	// `docs/route-plugins.md`.
	const routePluginCtx = {
		store: opts.store,
		drivers: opts.drivers,
		embedders: opts.embedders,
		secrets: opts.secrets,
		jobs: jobsStore,
		chatService: opts.chatService ?? null,
		chatConfig: opts.chatConfig ?? null,
		mcpConfig: opts.mcpConfig ?? { enabled: false, exposeChat: false },
		replicaId,
	};
	const plugins = opts.routePlugins ?? buildDefaultRoutePlugins(routePluginCtx);
	for (const plugin of plugins.list()) {
		app.route(plugin.mountPath, plugin.build(routePluginCtx));
	}

	registerCommonErrorResponses(app);
	registerSecuritySchemes(app);
	app.get("/api/v1/openapi.json", (c) => {
		const document = app.getOpenAPI31Document(OPENAPI_CONFIG);
		return c.json(withApiContractDefaults(document));
	});

	app.get(
		"/docs",
		Scalar({
			url: "/api/v1/openapi.json",
			theme: "default",
			pageTitle: "AI Workbench API",
			// Pin the Scalar bundle to a vetted version so the CSP
			// allow-list and the runtime's docs UI stay in lockstep.
			cdn: SCALAR_CDN_PINNED,
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

function errorResponse(description: string) {
	return {
		description,
		content: {
			"application/json": {
				schema: { $ref: "#/components/schemas/ErrorEnvelope" },
			},
		},
	};
}

function registerCommonErrorResponses(app: OpenAPIHono<AppEnv>): void {
	app.openAPIRegistry.registerComponent(
		"responses",
		"BadRequest",
		errorResponse("Malformed request or validation failure"),
	);
	app.openAPIRegistry.registerComponent(
		"responses",
		"Unauthorized",
		errorResponse("Authentication required or invalid"),
	);
	app.openAPIRegistry.registerComponent(
		"responses",
		"Forbidden",
		errorResponse("Authenticated subject is not allowed"),
	);
	app.openAPIRegistry.registerComponent(
		"responses",
		"Conflict",
		errorResponse("Resource state conflict"),
	);
	app.openAPIRegistry.registerComponent(
		"responses",
		"UnprocessableEntity",
		errorResponse(
			"Request is valid but cannot be processed in the current configuration",
		),
	);
	app.openAPIRegistry.registerComponent(
		"responses",
		"TooManyRequests",
		errorResponse("Rate limit exceeded"),
	);
	app.openAPIRegistry.registerComponent(
		"responses",
		"InternalServerError",
		errorResponse("Unexpected server error"),
	);
}

function registerSecuritySchemes(app: OpenAPIHono<AppEnv>): void {
	app.openAPIRegistry.registerComponent("securitySchemes", "WorkbenchApiKey", {
		type: "http",
		scheme: "bearer",
		bearerFormat: "wb_live_*",
		description:
			"Workbench API key sent as `Authorization: Bearer wb_live_<prefix>_<secret>`.",
	});
	app.openAPIRegistry.registerComponent("securitySchemes", "OidcBearer", {
		type: "http",
		scheme: "bearer",
		bearerFormat: "JWT",
		description:
			"OIDC access token sent as `Authorization: Bearer <jwt>` when OIDC auth is enabled.",
	});
}

type OpenApiOperation = {
	responses?: Record<string, unknown>;
	security?: Array<Record<string, string[]>>;
};

function withApiContractDefaults<T extends { paths?: unknown }>(
	document: T,
): T {
	if (!isRecord(document.paths)) return document;
	for (const [path, methods] of Object.entries(document.paths)) {
		if (!path.startsWith("/api/v1/workspaces")) continue;
		if (!isRecord(methods)) continue;
		for (const method of ["get", "post", "patch", "delete"] as const) {
			const operation = methods[method];
			if (!isOpenApiOperation(operation)) continue;
			operation.responses ??= {};
			for (const [status, name] of Object.entries(COMMON_API_ERROR_RESPONSES)) {
				operation.responses[status] = {
					$ref: `#/components/responses/${name}`,
				};
			}
			operation.security = [{ WorkbenchApiKey: [] }, { OidcBearer: [] }];
		}
	}
	return document;
}

function isOpenApiOperation(value: unknown): value is OpenApiOperation {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
