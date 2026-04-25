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
	.regex(/^[a-z]+:[^\s]+$/i, "expected '<provider>:<path>', e.g. 'env:FOO'");

const RuntimeSchema = z
	.object({
		port: z.number().int().min(1).max(65535).default(8080),
		logLevel: z
			.enum(["trace", "debug", "info", "warn", "error"])
			.default("info"),
		requestIdHeader: z.string().min(1).default("X-Request-Id"),
		// Static-asset directory for the embedded UI. `null` (default)
		// auto-detects common locations (see src/ui/assets.ts). The
		// `UI_DIR` env var also works as an override when set.
		uiDir: z.string().nullable().default(null),
	})
	.default({
		port: 8080,
		logLevel: "info",
		requestIdHeader: "X-Request-Id",
		uiDir: null,
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
		// Claim containing the list of workspace UIDs the subject may
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
	clientSecretRef: z
		.string()
		.regex(/^[a-z]+:[^\s]+$/i, "expected '<provider>:<path>'")
		.nullable()
		.default(null),
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
	// SecretRef for the HMAC key that signs session cookies. When
	// null, an ephemeral 32-byte key is generated at boot.
	sessionSecretRef: z
		.string()
		.regex(/^[a-z]+:[^\s]+$/i, "expected '<provider>:<path>'")
		.nullable()
		.default(null),
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
		oidc: OidcSchema.optional(),
	})
	.default({ mode: "disabled", anonymousPolicy: "allow" })
	.superRefine((cfg, ctx) => {
		if ((cfg.mode === "oidc" || cfg.mode === "any") && !cfg.oidc) {
			ctx.addIssue({
				code: "custom",
				path: ["oidc"],
				message: `auth.oidc is required when auth.mode='${cfg.mode}'`,
			});
		}
	});

const ControlPlaneSchema = z.discriminatedUnion("driver", [
	z.object({ driver: z.literal("memory") }),
	z.object({
		driver: z.literal("file"),
		root: z.string().min(1),
	}),
	z.object({
		driver: z.literal("astra"),
		endpoint: z.string().url(),
		tokenRef: SecretRef,
		keyspace: z.string().min(1).default("workbench"),
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
	endpoint: z.union([z.string().url(), SecretRef]).nullable().optional(),
	kind: z.enum(["astra", "hcd", "openrag", "mock"]),
	credentialsRef: z.record(z.string(), SecretRef).optional(),
	keyspace: z.string().nullable().optional(),
});

export const ConfigSchema = z
	.object({
		version: z.literal(1),
		runtime: RuntimeSchema,
		controlPlane: ControlPlaneSchema.default({ driver: "memory" }),
		auth: AuthSchema,
		seedWorkspaces: z.array(SeedWorkspaceSchema).default([]),
	})
	.superRefine((cfg, ctx) => {
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

// Lightweight alias to keep `Id` reachable for callers that want the
// same validator applied elsewhere (e.g. request validation).
export const IdSchema = Id;
