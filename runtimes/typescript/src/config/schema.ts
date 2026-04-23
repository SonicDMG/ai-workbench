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
 *     Ships in a later PR; rejected at startup today.
 *   - `oidc`: JWT bearer tokens from a configured OIDC issuer.
 *     Ships in a later PR.
 *   - `any`: both verifiers active; first match wins.
 *
 * `anonymousPolicy: reject` rejects any request without an
 * `Authorization` header with 401. In `disabled` mode this is the
 * only way to force authentication (there's nothing to verify
 * against) — useful for CI smoke tests.
 */
const AuthSchema = z
	.object({
		mode: z.enum(["disabled", "apiKey", "oidc", "any"]).default("disabled"),
		anonymousPolicy: z.enum(["allow", "reject"]).default("allow"),
	})
	.default({ mode: "disabled", anonymousPolicy: "allow" });

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
export type SeedWorkspace = z.infer<typeof SeedWorkspaceSchema>;

// Lightweight alias to keep `Id` reachable for callers that want the
// same validator applied elsewhere (e.g. request validation).
export const IdSchema = Id;
