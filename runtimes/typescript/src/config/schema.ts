/**
 * `workbench.yaml` schema.
 *
 * Shape (high level):
 *
 *   version: 1
 *   runtime:       { port, logLevel, requestIdHeader, uiDir }
 *   controlPlane:  discriminated on `driver`:
 *     memory:   { driver: "memory" }
 *     file:     { driver: "file", root: string }
 *     astra:    { driver: "astra", endpoint, tokenRef, keyspace }
 *   seedWorkspaces?: WorkspaceRecord-shaped array, loaded into the
 *     memory backend at startup. Ignored by file/astra.
 *
 * The older `workspaces:` block with per-workspace driver + auth +
 * nested vectorStores/catalogs is gone — those resources are now
 * mutable runtime data in the control-plane tables.
 */

import { z } from "zod";

const Id = z
	.string()
	.regex(/^[a-z][a-z0-9-]{0,63}$/, "must match /^[a-z][a-z0-9-]{0,63}$/");

const SecretRef = z
	.string()
	.regex(
		/^[a-z][a-z0-9]*:[^\s]+$/,
		"expected '<provider>:<path>', e.g. 'env:FOO'",
	);

/**
 * In-process rate limiter for `/api/v1/*` and `/auth/*`. Defense-in-
 * depth, not a substitute for an upstream WAF — buckets are per-
 * replica, so distributed deployments still need a network-level
 * limiter for accurate aggregate ceilings. Defaults are conservative
 * enough that normal clients won't notice.
 */
const RateLimitSchema = z
	.object({
		enabled: z.boolean().default(true),
		// Keep the API ceiling well above realistic browser/CLI usage
		// (10 req/sec sustained) but low enough to throttle a runaway
		// loop or naive scanner.
		capacity: z.number().int().min(1).max(1_000_000).default(600),
		windowMs: z.number().int().min(1_000).max(3_600_000).default(60_000),
	})
	.default({ enabled: true, capacity: 600, windowMs: 60_000 });

const RuntimeSchema = z
	.object({
		// `development` preserves the local-friendly defaults. Set
		// `production` in deploy configs to make the schema enforce the
		// hardening checklist instead of relying on docs-only guidance.
		environment: z.enum(["development", "production"]).default("development"),
		port: z.number().int().min(1).max(65535).default(8080),
		logLevel: z
			.enum(["trace", "debug", "info", "warn", "error"])
			.default("info"),
		requestIdHeader: z.string().min(1).default("X-Request-Id"),
		// Static-asset directory for the embedded UI. `null` (default)
		// auto-detects common locations (see src/ui/assets.ts). The
		// `UI_DIR` env var also works as an override when set.
		uiDir: z.string().nullable().default(null),
		// Identifier this replica writes into job leases. `null`
		// (default) makes the runtime pick one at boot — `${HOSTNAME
		// or "wb"}-<short-uuid>` — so K8s deployments get a greppable
		// pod name baked in. Set to a literal string to force a value
		// (useful in tests). Used by the cross-replica orphan sweeper
		// to tell whose lease is whose.
		replicaId: z.string().min(1).nullable().default(null),
		// Public browser origin for OIDC redirects/cookie security. In
		// production browser-login deployments this is required so the
		// runtime doesn't derive externally visible URLs from spoofable
		// Host / X-Forwarded-* request headers.
		publicOrigin: z.string().url().nullable().default(null),
		// Whether to trust X-Forwarded-Proto / X-Forwarded-Host for URL
		// and secure-cookie decisions. Keep false unless the runtime sits
		// behind a trusted reverse proxy that overwrites these headers.
		trustProxyHeaders: z.boolean().default(false),
		// In-process rate limiter for `/api/v1/*` and `/auth/*`. On by
		// default; tune capacity/windowMs or disable entirely.
		rateLimit: RateLimitSchema,
	})
	.default({
		environment: "development",
		port: 8080,
		logLevel: "info",
		requestIdHeader: "X-Request-Id",
		uiDir: null,
		replicaId: null,
		publicOrigin: null,
		trustProxyHeaders: false,
		rateLimit: { enabled: true, capacity: 600, windowMs: 60_000 },
	});

/**
 * Auth-middleware configuration.
 *
 * Default is `disabled` + `anonymousPolicy: allow` — matches the
 * runtime's pre-auth behavior so existing configs keep working.
 *
 * `mode` options:
 *   - `disabled`: middleware tags every request anonymous; no
 *     verification happens.
 *   - `apiKey`: workbench-issued `wb_live_*` keys are accepted.
 *   - `oidc`: JWT bearer tokens from a configured OIDC issuer are
 *     verified via JWKS. Requires `auth.oidc` block.
 *   - `any`: both verifiers active; API-key shape matches first
 *     (O(1) DB lookup), JWTs fall through to OIDC.
 *
 * `anonymousPolicy: reject` rejects any request without an
 * `Authorization` header with 401. In `disabled` mode this is the
 * only way to force authentication (there's nothing to verify
 * against) — useful for CI smoke tests.
 */
const OidcClaimsSchema = z
	.object({
		// JWT claim that identifies the subject. `sub` is the OIDC
		// default. Custom IdPs sometimes put a stable user UUID in a
		// different claim.
		subject: z.string().min(1).default("sub"),
		// Claim used as the human-readable label on `AuthSubject`.
		// `email` is the typical choice; `preferred_username` works too.
		label: z.string().min(1).default("email"),
		// Claim containing the list of workspace IDs the subject may
		// touch. The value must be a JSON array of strings. Missing or
		// empty means "no workspace access" (subject still authenticates
		// but hits 403 on every workspace route). Set to `null` on the
		// `workspaceScopes` field to mark the subject unscoped (admin).
		workspaceScopes: z.string().min(1).default("wb_workspace_scopes"),
	})
	.default({
		subject: "sub",
		label: "email",
		workspaceScopes: "wb_workspace_scopes",
	});

/**
 * Browser-login (Phase 3b) section. Optional. When set, the runtime
 * hosts `/auth/login`, `/auth/callback`, `/auth/me`, `/auth/logout`
 * so the web UI can do an OIDC authorization-code-with-PKCE flow
 * and park the resulting access token in a session cookie — no
 * paste-a-token required.
 *
 * `clientSecretRef` is optional: SPAs configured as public clients
 * omit the secret. Confidential-client IdPs (most of them, in
 * practice) require it.
 *
 * `sessionSecretRef` signs the session cookie. When null, the
 * runtime generates an ephemeral key at boot and logs a warning —
 * fine for dev / single-replica, wrong for anything clustered.
 */
const OidcClientSchema = z.object({
	clientId: z.string().min(1),
	clientSecretRef: SecretRef.nullable().default(null),
	// URL the IdP redirects back to after login. Must be registered
	// in the IdP's allowed redirect URIs. Absolute URL or a path that
	// resolves against the request origin.
	redirectPath: z.string().default("/auth/callback"),
	// Where to send the user after logout. Same rules as redirectPath.
	postLogoutPath: z.string().default("/"),
	// OAuth scopes to request. `openid` is mandatory; `profile email`
	// populate the label claim on most IdPs.
	scopes: z
		.array(z.string().min(1))
		.min(1)
		.default(["openid", "profile", "email"]),
	// Cookie name for the session. Change if something else on the
	// same origin already owns `wb_session`.
	sessionCookieName: z.string().min(1).default("wb_session"),
	// SecretRef for the key that encrypts session cookies. When null,
	// an ephemeral 32-byte key is generated at boot.
	sessionSecretRef: SecretRef.nullable().default(null),
});

const OidcSchema = z.object({
	// Token `iss` claim; MUST match exactly. Discovery URL is derived
	// from this when `jwksUri` isn't set.
	issuer: z.string().url(),
	// Token `aud` claim(s); at least one must match. Single string
	// is treated as a one-element list.
	audience: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
	// JWKS URL. When null, the runtime fetches
	// `${issuer}/.well-known/openid-configuration` at startup and uses
	// `jwks_uri` from the response.
	jwksUri: z.string().url().nullable().default(null),
	// Clock skew allowance for `exp` / `nbf` validation, in seconds.
	clockToleranceSeconds: z.number().int().min(0).max(300).default(30),
	// Claim-to-field mapping.
	claims: OidcClaimsSchema,
	// Optional browser-login block. When present the runtime hosts
	// the `/auth/*` endpoints.
	client: OidcClientSchema.optional(),
});

const AuthSchema = z
	.object({
		mode: z.enum(["disabled", "apiKey", "oidc", "any"]).default("disabled"),
		anonymousPolicy: z.enum(["allow", "reject"]).default("allow"),
		// Optional break-glass/operator token. The runtime resolves the
		// SecretRef at startup and accepts that bearer token as an
		// unscoped subject (workspaceScopes: null), allowing strict
		// deployments to create their first workspace/API key without
		// briefly opening anonymous access.
		bootstrapTokenRef: SecretRef.nullable().default(null),
		oidc: OidcSchema.optional(),
	})
	.default({
		mode: "disabled",
		anonymousPolicy: "allow",
		bootstrapTokenRef: null,
	})
	.superRefine((cfg, ctx) => {
		if ((cfg.mode === "oidc" || cfg.mode === "any") && !cfg.oidc) {
			ctx.addIssue({
				code: "custom",
				path: ["oidc"],
				message: `auth.oidc is required when auth.mode='${cfg.mode}'`,
			});
		}
		if (cfg.mode === "disabled" && cfg.bootstrapTokenRef) {
			ctx.addIssue({
				code: "custom",
				path: ["bootstrapTokenRef"],
				message:
					"auth.bootstrapTokenRef is only valid when auth.mode is apiKey, oidc, or any",
			});
		}
	});

/**
 * Cross-replica orphan-sweeper configuration. Off by default — only
 * useful for clustered deployments where the runtime can crash
 * mid-ingest while another replica stays up. Single-replica operators
 * don't need it (their pipelines always fail-fast on the same
 * process). When enabled, every replica scans the durable job store
 * once per `intervalMs` for `running` records whose lease is older
 * than `graceMs` and CAS-claims them, marking them `failed` so
 * clients see a terminal state.
 */
const JobsResumeSchema = z
	.object({
		enabled: z.boolean().default(false),
		graceMs: z.number().int().min(1_000).max(600_000).default(60_000),
		intervalMs: z.number().int().min(1_000).max(600_000).default(60_000),
	})
	.default({ enabled: false, graceMs: 60_000, intervalMs: 60_000 });

const ControlPlaneSchema = z.discriminatedUnion("driver", [
	z.object({
		driver: z.literal("memory"),
		jobsResume: JobsResumeSchema.optional(),
	}),
	z.object({
		driver: z.literal("file"),
		root: z.string().min(1),
		jobsResume: JobsResumeSchema.optional(),
	}),
	z.object({
		driver: z.literal("astra"),
		endpoint: z.string().url(),
		tokenRef: SecretRef,
		keyspace: z.string().min(1).default("workbench"),
		jobsResume: JobsResumeSchema.optional(),
		/**
		 * Cross-replica job-subscriber poll interval, ms. Each Astra
		 * job subscriber polls the underlying record at this cadence
		 * to pick up updates that landed on a *different* replica
		 * (same-replica updates fan out instantly through the
		 * in-process listener registry). Default 500ms; raise for
		 * cost-sensitive deployments where second-scale staleness is
		 * fine, lower for hot SSE work where every chunk matters.
		 * The poller is a no-op when no one is subscribed.
		 *
		 * Background: docs/cross-replica-jobs.md.
		 */
		jobPollIntervalMs: z.number().int().min(50).max(60_000).default(500),
	}),
]);

/** One of the records loaded into the memory control plane at startup. */
const SeedWorkspaceSchema = z.object({
	uid: z.string().uuid().optional(),
	name: z.string().min(1),
	url: z.union([z.string().url(), SecretRef]).nullable().optional(),
	kind: z.enum(["astra", "hcd", "openrag", "mock"]),
	keyspace: z.string().nullable().optional(),
	credentials: z.record(z.string(), SecretRef).optional(),
});

/**
 * Chat configuration shared by all agents in this runtime. When unset
 * the chat surface still accepts user messages but answers with a
 * `chat_disabled` response — the runtime stays usable for everything
 * else.
 *
 * `tokenRef` resolves to the HuggingFace inference API token at
 * request time; the resolver caches the result for the lifetime of
 * the chat service. Default model is one of the most reliable hosted
 * instruction-tuned chat models on the HF Inference API.
 */
const ChatSchema = z.object({
	tokenRef: SecretRef,
	model: z.string().min(1).default("mistralai/Mistral-7B-Instruct-v0.3"),
	maxOutputTokens: z.number().int().positive().max(8_192).default(1_024),
	/**
	 * Top-K KB chunks to retrieve **per knowledge base** when assembling
	 * the prompt. Multi-KB chats fan out and then merge by score; the
	 * cap on total context lives in the chat service.
	 */
	retrievalK: z.number().int().positive().max(64).default(6),
	/**
	 * Override the runtime's default agent persona. `null` keeps
	 * `DEFAULT_AGENT_SYSTEM_PROMPT` from control-plane/defaults.ts;
	 * per-agent prompts on `agent.systemPrompt` always take precedence
	 * over this fallback.
	 */
	systemPrompt: z.string().min(1).nullable().default(null),
});

/**
 * Model Context Protocol server. When enabled, the runtime mounts an
 * MCP endpoint at `/api/v1/workspaces/{w}/mcp` that exposes the
 * workspace's read surface (KB search, document listing, chat
 * history) as MCP tools and resources. External agents
 * (Claude / Cursor / Continue / hosted gateways) can connect over
 * Streamable HTTP and use the workspace as a context backend.
 *
 * Default off so existing deployments don't accidentally expand
 * their attack surface. Enable explicitly via `mcp.enabled: true`.
 */
const McpSchema = z.object({
	enabled: z.boolean().default(false),
	/**
	 * Surface the chat tool (`chat_send`) which appends a turn to an
	 * agent-owned conversation and returns the assistant reply.
	 * Inherits the runtime's `chat` configuration; if `chat` is unset
	 * the tool simply isn't registered. Default off so MCP clients
	 * that just want retrieval don't accidentally rack up inference
	 * cost.
	 */
	exposeChat: z.boolean().default(false),
});

export const ConfigSchema = z
	.object({
		version: z.literal(1),
		runtime: RuntimeSchema,
		controlPlane: ControlPlaneSchema.default({ driver: "memory" }),
		auth: AuthSchema,
		seedWorkspaces: z.array(SeedWorkspaceSchema).default([]),
		chat: ChatSchema.optional(),
		mcp: McpSchema.default({ enabled: false, exposeChat: false }),
	})
	.superRefine((cfg, ctx) => {
		if (cfg.runtime.environment === "production") {
			if (cfg.controlPlane.driver === "memory") {
				ctx.addIssue({
					code: "custom",
					path: ["controlPlane", "driver"],
					message:
						"runtime.environment='production' requires a durable control plane (file or astra)",
				});
			}
			if (cfg.auth.mode === "disabled") {
				ctx.addIssue({
					code: "custom",
					path: ["auth", "mode"],
					message:
						"runtime.environment='production' requires auth.mode to be apiKey, oidc, or any",
				});
			}
			if (cfg.auth.anonymousPolicy !== "reject") {
				ctx.addIssue({
					code: "custom",
					path: ["auth", "anonymousPolicy"],
					message:
						"runtime.environment='production' requires auth.anonymousPolicy='reject'",
				});
			}
			const publicOrigin = cfg.runtime.publicOrigin;
			if (publicOrigin && new URL(publicOrigin).protocol !== "https:") {
				ctx.addIssue({
					code: "custom",
					path: ["runtime", "publicOrigin"],
					message:
						"runtime.environment='production' requires runtime.publicOrigin to use https",
				});
			}
			const client = cfg.auth.oidc?.client;
			if (client) {
				if (!client.sessionSecretRef) {
					ctx.addIssue({
						code: "custom",
						path: ["auth", "oidc", "client", "sessionSecretRef"],
						message:
							"runtime.environment='production' with OIDC browser login requires auth.oidc.client.sessionSecretRef",
					});
				}
				if (!publicOrigin) {
					ctx.addIssue({
						code: "custom",
						path: ["runtime", "publicOrigin"],
						message:
							"runtime.environment='production' with OIDC browser login requires runtime.publicOrigin",
					});
				}
			}
		}
		if (cfg.seedWorkspaces.length > 0 && cfg.controlPlane.driver !== "memory") {
			ctx.addIssue({
				code: "custom",
				path: ["seedWorkspaces"],
				message:
					"seedWorkspaces is only meaningful with controlPlane.driver='memory'; use the API to create workspaces on file/astra",
			});
		}
		const names = new Set<string>();
		cfg.seedWorkspaces.forEach((ws, i) => {
			if (names.has(ws.name)) {
				ctx.addIssue({
					code: "custom",
					path: ["seedWorkspaces", i, "name"],
					message: `duplicate seed workspace name '${ws.name}'`,
				});
			}
			names.add(ws.name);
		});
	});

export type Config = z.infer<typeof ConfigSchema>;
export type ControlPlaneConfig = Config["controlPlane"];
export type AuthConfig = Config["auth"];
export type OidcConfig = z.infer<typeof OidcSchema>;
export type OidcClientConfig = z.infer<typeof OidcClientSchema>;
export type SeedWorkspace = z.infer<typeof SeedWorkspaceSchema>;
export type ChatConfig = z.infer<typeof ChatSchema>;
export type McpConfig = z.infer<typeof McpSchema>;

// Lightweight alias to keep `Id` reachable for callers that want the
// same validator applied elsewhere (e.g. request validation).
export const IdSchema = Id;
