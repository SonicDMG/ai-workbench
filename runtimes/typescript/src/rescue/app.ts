/**
 * Rescue-mode HTTP app.
 *
 * Spun up by `main()` in `root.ts` when control-plane initialization
 * throws (typo'd Astra endpoint, bad token, network unreachable,
 * …). Without this fallback, the runtime exits and the operator is
 * left with no in-app way to fix the credentials they just entered
 * — exactly the dead-end the `/settings` page was added to
 * eliminate.
 *
 * Surface area is intentionally tiny:
 *   - `GET  /setup-status` — returns the standard envelope with the
 *     classified `bootError` field set, so the SPA can render a
 *     prominent banner steering the operator to `/settings`.
 *   - `POST /setup/env`    — same managed-env writer as healthy
 *     boot, so the user can paste corrected credentials.
 *   - `POST /setup/restart` — triggers `triggerRestart()` (graceful
 *     shutdown → container restart policy → retry full boot).
 *   - `GET  /healthz` + `GET /readyz` — always 503; this runtime is
 *     not serving real traffic.
 *   - SPA static + index.html fallback so `/settings` actually
 *     renders.
 *
 * Everything under `/api/v1/*` returns 503 `control_plane_unavailable`
 * — no control plane, no data plane.
 */
import { Hono } from "hono";
import { errorEnvelope } from "../lib/errors.js";
import type { AppEnv } from "../lib/types.js";
import type { SetupBootError } from "../routes/setup.js";
import {
	describeManagedEnv,
	MANAGED_ENV_KEYS,
	type ManagedEnvKey,
	writeManagedEnv,
} from "../setup/managed-env.js";
import { isSpaPath, type UiAssets } from "../ui/assets.js";

export interface RescueAppDeps {
	readonly bootError: SetupBootError;
	readonly triggerRestart: () => void;
	readonly ui: UiAssets | null;
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

/**
 * Classify a control-plane boot failure into a small set of
 * machine-readable codes the SPA can branch on. The full underlying
 * error message is always preserved so the operator sees the actual
 * cause; the code is just a hint for which remediation copy to
 * surface.
 */
export function classifyBootError(err: unknown): SetupBootError {
	const message = err instanceof Error ? err.message : String(err);
	const code = errorCodeFor(err, message);
	return { code, message };
}

function errorCodeFor(err: unknown, message: string): string {
	// Node net errors carry `.code` (ENOTFOUND, ETIMEDOUT, ECONNREFUSED, …).
	const nodeCode =
		err && typeof err === "object" && "code" in err
			? String((err as { code?: unknown }).code ?? "")
			: "";
	if (nodeCode === "ENOTFOUND") return "control_plane_dns_unresolvable";
	if (nodeCode === "ETIMEDOUT") return "control_plane_unreachable";
	if (nodeCode === "ECONNREFUSED") return "control_plane_unreachable";
	if (/401|unauthorized|invalid.*token/i.test(message)) {
		return "control_plane_unauthorized";
	}
	if (/403|forbidden/i.test(message)) {
		return "control_plane_forbidden";
	}
	return "control_plane_unavailable";
}

export function buildRescueApp(deps: RescueAppDeps): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.get("/healthz", (c) =>
		c.json({ status: "degraded", reason: deps.bootError.code }, 503),
	);
	app.get("/readyz", (c) =>
		c.json({ status: "degraded", reason: deps.bootError.code }, 503),
	);

	app.get("/setup-status", async (c) => {
		const managedEnv = await describeManagedEnv();
		const hasAstraCreds = Boolean(
			process.env.ASTRA_DB_API_ENDPOINT &&
				process.env.ASTRA_DB_APPLICATION_TOKEN,
		);
		return c.json({
			setupComplete: false,
			workspacesCount: 0,
			controlPlane: { kind: "unavailable", healthy: false },
			hasChatProvider: false,
			hasAstraCreds,
			managedEnv,
			bootError: deps.bootError,
		});
	});

	app.post("/setup/env", async (c) => {
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

	app.post("/setup/restart", (c) => {
		const response = c.json(
			{
				ok: true,
				note: "Graceful shutdown initiated; container restart policy will bring the runtime back with the updated credentials.",
			},
			202,
		);
		setImmediate(() => deps.triggerRestart());
		return response;
	});

	// Everything under `/api/v1/*` is unavailable in rescue mode.
	app.all("/api/v1/*", (c) =>
		c.json(
			errorEnvelope(
				c,
				"control_plane_unavailable",
				`Runtime is in rescue mode (${deps.bootError.code}): ${deps.bootError.message}. Fix credentials at /settings and trigger a restart.`,
			),
			503,
		),
	);

	// Mount the SPA so `/settings` actually renders. Without this the
	// rescue app would only be reachable via curl — the whole point
	// is to let the operator paste fixed credentials through the UI.
	const ui = deps.ui;
	if (ui) {
		app.use("*", ui.staticMiddleware);
		app.get("*", (c) => {
			if (!isSpaPath(c.req.path)) {
				return c.json(
					errorEnvelope(c, "not_found", `Route ${c.req.path} not found`),
					404,
				);
			}
			return ui.spaFallback(c);
		});
	}

	return app;
}
