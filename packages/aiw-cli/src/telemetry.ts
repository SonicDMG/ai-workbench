/**
 * CLI-side opt-in telemetry mirror.
 *
 * Mirrors the runtime emitter ([`runtimes/typescript/src/lib/telemetry.ts`](../../runtimes/typescript/src/lib/telemetry.ts)):
 * off by default, enable with `AIW_TELEMETRY=1`, point at a sink with
 * `AIW_TELEMETRY_URL=https://…`. Wired-but-dark when enabled without
 * a URL (events are constructed but never sent).
 *
 * Events:
 *   - `command_run`: the top-level subcommand name only (`workspace`,
 *     `kb`, `doctor`, …). Argument values are never captured.
 *   - `error`: the server-side error code (or `network_error` /
 *     `request_timeout` for transport-layer failures) plus the
 *     resolved exit code. No message body.
 *
 * Install id lives at `$AIW_CONFIG_HOME/.install-id` (or the
 * resolved CLI config dir) so it persists across `docker compose
 * down/up` in the same volume as the profile file.
 *
 * Fire-and-forget. A 2 s timeout caps how long the CLI waits for the
 * sink before giving up.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultConfigLocation } from "./config.js";

const POST_TIMEOUT_MS = 2_000;
const INSTALL_ID_FILENAME = ".install-id";

function envFlagTrue(v: string | undefined): boolean {
	if (!v) return false;
	const s = v.trim().toLowerCase();
	return s === "1" || s === "true" || s === "yes" || s === "on";
}

function installIdPath(env: NodeJS.ProcessEnv): string {
	const override = env.AIW_INSTALL_ID_FILE?.trim();
	if (override) return override;
	const loc = defaultConfigLocation(env);
	return join(dirname(loc.file), INSTALL_ID_FILENAME);
}

function resolveInstallId(env: NodeJS.ProcessEnv): string {
	const path = installIdPath(env);
	try {
		if (existsSync(path)) {
			const raw = readFileSync(path, "utf8").trim();
			if (/^[a-f0-9]{32}$/.test(raw)) return raw;
		}
	} catch {
		// fall through and write a fresh one
	}
	const id = randomUUID().replace(/-/g, "");
	try {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		writeFileSync(path, `${id}\n`, { encoding: "utf8", mode: 0o600 });
	} catch {
		// read-only home / shared image — fall back to in-memory id
	}
	return id;
}

export interface CliTelemetry {
	readonly enabled: boolean;
	readonly dark: boolean;
	readonly installId: string;
	emit(
		event: string,
		fields?: Readonly<Record<string, string | number | boolean | null>>,
	): void;
}

const NO_OP: CliTelemetry = {
	enabled: false,
	dark: false,
	installId: "",
	emit() {},
};

export interface BuildCliTelemetryDeps {
	readonly version: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly fetchImpl?: typeof fetch;
}

export function buildCliTelemetry(deps: BuildCliTelemetryDeps): CliTelemetry {
	const env = deps.env ?? process.env;
	if (!envFlagTrue(env.AIW_TELEMETRY)) return NO_OP;
	const url = env.AIW_TELEMETRY_URL?.trim() || null;
	const installId = resolveInstallId(env);
	const dark = url === null;
	const fetchImpl = deps.fetchImpl ?? fetch;
	return {
		enabled: true,
		dark,
		installId,
		emit(event, fields = {}) {
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
				.catch(() => {
					// swallow — telemetry must never fail the user's command.
				})
				.finally(() => clearTimeout(timer));
		},
	};
}

export function noopCliTelemetry(): CliTelemetry {
	return NO_OP;
}

/**
 * Extract the top-level subcommand name from `argv` for the
 * `command_run` event. Avoids capturing flag values: it walks until
 * the first non-`--`/`-` token. Returns `"<unknown>"` when no
 * subcommand was supplied so we can still attribute the invocation.
 */
export function commandNameFromArgv(argv: readonly string[]): string {
	for (const token of argv.slice(2)) {
		if (token.startsWith("-")) continue;
		return token;
	}
	return "<unknown>";
}
