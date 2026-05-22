/**
 * Opt-in anonymous telemetry. Off by default; even when on, no PII
 * leaves the process — events carry only the anonymous install id,
 * version, and a small allow-list of categorical fields (event name,
 * command name, error code, control-plane kind, configured providers).
 *
 * Posture:
 *   - `enabled` resolves from `runtime.telemetry.enabled` in YAML OR
 *     `WORKBENCH_TELEMETRY=1` in env (env wins).
 *   - `url` resolves from `runtime.telemetry.url` OR
 *     `WORKBENCH_TELEMETRY_URL` (env wins).
 *   - When `enabled` but `url` is null, the emitter constructs events
 *     and logs `telemetry: dark mode (no sink configured)` — useful
 *     so operators can verify the wiring before pointing it at a
 *     real sink.
 *   - When disabled, every {@link TelemetryEmitter} method is a
 *     synchronous no-op.
 *
 * Wire format: `POST <url>` with `Content-Type: application/json`,
 * body `{ installId, version, event, fields }`. Fire-and-forget with
 * a 2 s timeout — sink unreachability never blocks the runtime.
 *
 * Install id: 32-char hex written to `$WORKBENCH_DATA_DIR/.install-id`
 * (mode `0600`) on first read. Survives `docker compose down/up` in
 * the same named volume that holds control-plane state.
 *
 * See `docs/telemetry.md` for the full event catalog and opt-out
 * instructions.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { logger } from "./logger.js";

export interface TelemetryConfigInput {
	readonly enabled: boolean;
	readonly url: string | null;
}

export interface TelemetryEmitter {
	readonly enabled: boolean;
	readonly dark: boolean;
	readonly installId: string;
	emit(
		event: string,
		fields?: Readonly<Record<string, string | number | boolean | null>>,
	): void;
}

const NO_OP_EMITTER: TelemetryEmitter = {
	enabled: false,
	dark: false,
	installId: "",
	emit() {},
};

const POST_TIMEOUT_MS = 2_000;
const INSTALL_ID_FILENAME = ".install-id";

/**
 * Resolve where the anonymous install id lives. Mirrors the
 * managed-env path: `$WORKBENCH_DATA_DIR/.install-id` in production,
 * `./.workbench-data/.install-id` for repo-relative dev.
 */
function installIdPath(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.WORKBENCH_INSTALL_ID_FILE?.trim();
	if (override) return resolve(override);
	const dataDir = env.WORKBENCH_DATA_DIR?.trim();
	if (dataDir) return join(resolve(dataDir), INSTALL_ID_FILENAME);
	return resolve("./.workbench-data", INSTALL_ID_FILENAME);
}

/**
 * Read the install id, creating + persisting it on first call. The
 * id is a UUIDv4 with the dashes stripped — 32 hex chars, opaque to
 * the sink. Best-effort: if the directory is read-only, the id stays
 * in-memory and the file write is skipped (operator still gets a
 * stable id for the process lifetime).
 */
function resolveInstallId(env: NodeJS.ProcessEnv = process.env): string {
	const path = installIdPath(env);
	try {
		if (existsSync(path)) {
			const raw = readFileSync(path, "utf8").trim();
			if (/^[a-f0-9]{32}$/.test(raw)) return raw;
		}
	} catch {
		// fall through to write a fresh one
	}
	const id = randomUUID().replace(/-/g, "");
	try {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		writeFileSync(path, `${id}\n`, { encoding: "utf8", mode: 0o600 });
	} catch (err) {
		logger.debug(
			{ err: err instanceof Error ? err.message : String(err), path },
			"telemetry: could not persist install id; using in-memory value",
		);
	}
	return id;
}

function envFlagTrue(value: string | undefined): boolean {
	if (!value) return false;
	const v = value.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}

export interface BuildTelemetryDeps {
	readonly config: TelemetryConfigInput | null | undefined;
	readonly version: string;
	readonly env?: NodeJS.ProcessEnv;
	/** Test seam. Defaults to global `fetch`. */
	readonly fetchImpl?: typeof fetch;
}

/**
 * Construct a {@link TelemetryEmitter} from config + env. Always
 * returns a valid emitter — when telemetry is off the returned
 * object is a synchronous no-op (every `emit()` returns immediately).
 *
 * Logs a one-line banner on first construction so the operator
 * always knows the current posture without grepping config.
 */
export function buildTelemetryEmitter(
	deps: BuildTelemetryDeps,
): TelemetryEmitter {
	const env = deps.env ?? process.env;
	const enabled =
		envFlagTrue(env.WORKBENCH_TELEMETRY) || deps.config?.enabled === true;
	if (!enabled) {
		logger.info(
			"telemetry is OFF (opt in with WORKBENCH_TELEMETRY=1 or runtime.telemetry.enabled: true — see docs/telemetry.md)",
		);
		return NO_OP_EMITTER;
	}
	const url = env.WORKBENCH_TELEMETRY_URL?.trim() || deps.config?.url || null;
	const installId = resolveInstallId(env);
	const dark = url === null;
	if (dark) {
		logger.info(
			{ installId },
			"telemetry: dark mode (no sink configured). Events are constructed but never sent. Set WORKBENCH_TELEMETRY_URL to point at a sink.",
		);
	} else {
		logger.info({ installId, url }, "telemetry enabled");
	}
	const fetchImpl = deps.fetchImpl ?? fetch;
	const post = (event: string, fields: Record<string, unknown>): void => {
		if (dark || !url) return;
		const body = JSON.stringify({
			installId,
			version: deps.version,
			event,
			fields,
		});
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
		fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
			signal: controller.signal,
		})
			.catch((err: unknown) => {
				logger.debug(
					{
						err: err instanceof Error ? err.message : String(err),
						event,
					},
					"telemetry POST failed (continuing)",
				);
			})
			.finally(() => clearTimeout(timer));
	};
	return {
		enabled: true,
		dark,
		installId,
		emit(event, fields = {}) {
			post(event, { ...fields });
		},
	};
}

/**
 * Always-off emitter, exported for tests / callers that explicitly
 * want to opt out without going through {@link buildTelemetryEmitter}.
 */
export function noopTelemetryEmitter(): TelemetryEmitter {
	return NO_OP_EMITTER;
}
