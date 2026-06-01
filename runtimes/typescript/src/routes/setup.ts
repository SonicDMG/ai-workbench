/**
 * Setup wizard routes — the runtime-side counterpart to the web
 * onboarding wizard. Mounted at the top level (NOT under
 * `/api/v1/workspaces`) because they need to be reachable before any
 * workspace exists and before the standard auth middleware is
 * applied. Auth posture is enforced inline by {@link setupAuthGate}.
 *
 * Routes:
 *   GET  /setup-status      — what the wizard needs to render
 *   POST /setup/env         — write the managed dotenv file
 *   POST /setup/restart     — graceful shutdown so compose restarts
 *
 * The setup endpoints stay deliberately small: they neither read the
 * managed values back nor mutate `process.env`. The runtime picks
 * up the new file on the *next* boot via `WORKBENCH_ENV_FILE`.
 */
import type { Context } from "hono";
import { Hono } from "hono";
import type { AuthConfig } from "../config/schema.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import { errorEnvelope } from "../lib/errors.js";
import type { AppEnv } from "../lib/types.js";
import type { SecretResolver } from "../secrets/provider.js";
import { setupAuthGate } from "../setup/auth-gate.js";
import {
	describeManagedEnv,
	MANAGED_ENV_KEYS,
	type ManagedEnvKey,
	writeManagedEnv,
} from "../setup/managed-env.js";

export interface SetupRouteDeps {
	readonly store: ControlPlaneStore;
	readonly auth: AuthConfig;
	readonly secrets: SecretResolver;
	readonly chatConfigured: boolean;
	/** Hook the production graceful-shutdown function in here. Tests pass a spy. */
	readonly triggerRestart: () => void;
}

/**
 * Boot-failure classification surfaced to the SPA when the runtime
 * came up in rescue mode (control-plane init threw). Always absent
 * on a healthy boot — the field is purely additive so old SPA
 * builds that don't know about it keep working.
 */
export interface SetupBootError {
	readonly code: string;
	readonly message: string;
}

export interface SetupStatusBody {
	readonly setupComplete: boolean;
	readonly workspacesCount: number;
	readonly controlPlane: { kind: string; healthy: boolean };
	readonly hasChatProvider: boolean;
	readonly hasAstraCreds: boolean;
	readonly managedEnv: {
		path: string;
		writable: boolean;
		present: boolean;
		/**
		 * Which allow-listed keys currently resolve to a non-empty value
		 * in the runtime's environment (from the managed file or shell
		 * env). Lets the settings UI confirm per-field which credentials
		 * are already configured without ever returning the values.
		 */
		configuredKeys: readonly string[];
	};
	readonly bootError?: SetupBootError;
}

async function readSetupStatus(deps: SetupRouteDeps): Promise<SetupStatusBody> {
	const probe = await deps.store
		.listWorkspaces()
		.then((items) => ({ count: items.length, healthy: true }))
		.catch(() => ({ count: 0, healthy: false }));
	const managedEnv = await describeManagedEnv();
	const configuredKeys = MANAGED_ENV_KEYS.filter((key) =>
		Boolean(process.env[key]?.trim()),
	);
	const hasAstraCreds = Boolean(
		process.env.ASTRA_DB_API_ENDPOINT && process.env.ASTRA_DB_APPLICATION_TOKEN,
	);
	return {
		setupComplete: probe.count > 0,
		workspacesCount: probe.count,
		controlPlane: {
			kind: controlPlaneKind(deps.store),
			healthy: probe.healthy,
		},
		hasChatProvider: deps.chatConfigured,
		hasAstraCreds,
		managedEnv: { ...managedEnv, configuredKeys },
	};
}

function controlPlaneKind(store: ControlPlaneStore): string {
	const ctor = store.constructor.name;
	if (ctor.startsWith("Memory")) return "memory";
	if (ctor.startsWith("File")) return "file";
	if (ctor.startsWith("Astra")) return "astra";
	return ctor.toLowerCase();
}

interface SetupEnvBody {
	readonly values: Partial<Record<ManagedEnvKey, string>>;
}

function parseSetupEnvBody(raw: unknown): SetupEnvBody | { error: string } {
	if (!raw || typeof raw !== "object")
		return { error: "body must be an object" };
	const obj = raw as Record<string, unknown>;
	const values = obj.values;
	if (!values || typeof values !== "object" || Array.isArray(values)) {
		return { error: "body.values must be an object" };
	}
	const out: Partial<Record<ManagedEnvKey, string>> = {};
	for (const [key, value] of Object.entries(
		values as Record<string, unknown>,
	)) {
		if (!MANAGED_ENV_KEYS.includes(key as ManagedEnvKey)) {
			return {
				error: `unknown key "${key}"; allow-list: ${MANAGED_ENV_KEYS.join(", ")}`,
			};
		}
		if (typeof value !== "string") {
			return { error: `values.${key} must be a string` };
		}
		if (value.length === 0) continue;
		out[key as ManagedEnvKey] = value;
	}
	return { values: out };
}

export function setupRoutes(deps: SetupRouteDeps): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.get("/setup-status", async (c) => c.json(await readSetupStatus(deps)));

	const gate = setupAuthGate(deps);

	app.post("/setup/env", gate, async (c) => {
		const raw = await c.req.json().catch(() => null);
		const parsed = parseSetupEnvBody(raw);
		if ("error" in parsed) {
			return c.json(errorEnvelope(c, "validation_error", parsed.error), 400);
		}
		try {
			const status = await writeManagedEnv(parsed.values);
			return c.json(
				{
					ok: true,
					managedEnv: status,
					written: Object.keys(parsed.values).sort(),
					restartRequired: true,
				},
				200,
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json(
				errorEnvelope(
					c,
					"internal_error",
					`failed to write managed env: ${message}`,
				),
				500,
			);
		}
	});

	app.post("/setup/restart", gate, (c: Context<AppEnv>) => {
		// Respond first, then trigger the shutdown so the client sees
		// the 202 before the server starts draining.
		const response = c.json(
			{
				ok: true,
				note: "Graceful shutdown initiated; container restart policy will bring the runtime back.",
			},
			202,
		);
		// Defer to the next tick so the response body flushes.
		setImmediate(() => deps.triggerRestart());
		return response;
	});

	return app;
}
