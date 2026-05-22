/**
 * `aiw doctor` — pre-flight diagnostics.
 *
 * Runs a fixed checklist against the active profile, prints a
 * PASS/WARN/FAIL row per check, and exits:
 *   0 — all green
 *   1 — at least one FAIL
 *   2 — at least one WARN, no FAIL
 *
 * Each check returns a remediation hint when it isn't PASS, and the
 * envelope's `docs` field (when present) lands in the output so a
 * user can jump straight to docs/errors.md.
 *
 * The doctor stays read-only — no writes, no implicit logins. It
 * tolerates a runtime that isn't fully configured (chat disabled,
 * Astra creds missing) — those degrade to WARN, not FAIL, so the
 * checklist is meaningful even on a fresh install.
 *
 * Also implements `--explain <code>` which prints the registry entry
 * for an error code, fetched from `GET /error-codes`.
 */
import { defineCommand } from "citty";
import pc from "picocolors";
import { z } from "zod";
import {
	defaultConfigLocation,
	type Profile,
	readConfig,
	resolveProfile,
} from "../config.js";
import { ExitCode } from "../exit-codes.js";
import { HttpError, request } from "../http.js";
import { emit, fail, type OutputFormat, parseOutputFormat } from "../output.js";
import { WhoAmISchema } from "../types.js";

type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
	readonly id: string;
	readonly label: string;
	readonly status: CheckStatus;
	readonly detail?: string;
	readonly hint?: string;
	readonly docs?: string;
}

interface DoctorReport {
	readonly profile: string | null;
	readonly url: string | null;
	readonly checks: readonly CheckResult[];
	readonly summary: { pass: number; warn: number; fail: number };
}

const VersionSchema = z
	.object({
		version: z.string().optional(),
		commit: z.string().optional(),
		buildTime: z.string().optional(),
		node: z.string().optional(),
	})
	.passthrough();

const ReadySchema = z
	.object({
		status: z.string().optional(),
		workspaces: z.number().optional(),
		ingest: z
			.object({
				active: z.number().optional(),
				queued: z.number().optional(),
				capacity: z.number().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

const FeaturesSchema = z
	.object({
		mcp: z
			.object({
				enabled: z.boolean().optional(),
				baseUrl: z.string().nullable().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

const AstraCliSchema = z
	.object({
		status: z.string().optional(),
		profile: z.string().nullable().optional(),
	})
	.passthrough();

const ErrorCodeEntrySchema = z.object({
	code: z.string(),
	defaultStatus: z.number(),
	hint: z.string(),
	docs: z.string(),
});
const ErrorCodesResponseSchema = z.object({
	codes: z.array(ErrorCodeEntrySchema),
});

function pass(id: string, label: string, detail?: string): CheckResult {
	return { id, label, status: "pass", detail };
}
function warn(
	id: string,
	label: string,
	detail: string,
	hint?: string,
): CheckResult {
	return { id, label, status: "warn", detail, hint };
}
function fl(
	id: string,
	label: string,
	detail: string,
	hint?: string,
	docs?: string,
): CheckResult {
	return { id, label, status: "fail", detail, hint, docs };
}

function summarise(checks: readonly CheckResult[]): DoctorReport["summary"] {
	const out = { pass: 0, warn: 0, fail: 0 };
	for (const c of checks) out[c.status] += 1;
	return out;
}

function exitCodeFor(summary: DoctorReport["summary"]): number {
	if (summary.fail > 0) return ExitCode.RUNTIME_ERROR;
	if (summary.warn > 0) return ExitCode.USAGE_ERROR;
	return ExitCode.OK;
}

function renderHuman(report: DoctorReport): string {
	const lines: string[] = [];
	lines.push(
		`Profile: ${report.profile ?? pc.dim("(none)")}   URL: ${report.url ?? pc.dim("(none)")}`,
	);
	lines.push("");
	for (const c of report.checks) {
		const badge =
			c.status === "pass"
				? pc.green("PASS")
				: c.status === "warn"
					? pc.yellow("WARN")
					: pc.red("FAIL");
		lines.push(`${badge}  ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
		if (c.hint) lines.push(`      ${pc.yellow("hint:")} ${c.hint}`);
		if (c.docs) lines.push(`      ${pc.dim("docs:")} ${c.docs}`);
	}
	lines.push("");
	lines.push(
		`Summary: ${pc.green(`${report.summary.pass} pass`)}, ${pc.yellow(`${report.summary.warn} warn`)}, ${pc.red(`${report.summary.fail} fail`)}`,
	);
	return lines.join("\n");
}

async function probeJson<T>(
	url: string,
	path: string,
	schema: z.ZodType<T>,
): Promise<T | null> {
	try {
		const res = await fetch(`${url.replace(/\/+$/, "")}${path}`, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return null;
		const body = await res.json();
		const parsed = schema.safeParse(body);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

async function checkRuntimeReachable(url: string): Promise<CheckResult> {
	const data = await probeJson(url, "/version", VersionSchema);
	if (!data) {
		return fl(
			"runtime",
			"Runtime reachable",
			`could not GET ${url}/version`,
			"Is the workbench container running? `docker compose ps` or `docker compose up`.",
		);
	}
	const v = data.version ?? "unknown";
	return pass("runtime", "Runtime reachable", `version ${v}`);
}

async function checkReadiness(url: string): Promise<CheckResult> {
	try {
		const res = await fetch(`${url.replace(/\/+$/, "")}/readyz`, {
			signal: AbortSignal.timeout(5000),
		});
		const body = await res.json().catch(() => ({}));
		const parsed = ReadySchema.safeParse(body);
		if (res.status === 503) {
			return fl(
				"readiness",
				"Runtime ready",
				`/readyz returned 503${parsed.success && parsed.data.status ? ` (${parsed.data.status})` : ""}`,
				"The runtime is draining or its control plane is unreachable.",
				"docs/errors.md#control-plane-unavailable",
			);
		}
		if (!res.ok || !parsed.success) {
			return fl("readiness", "Runtime ready", `/readyz returned ${res.status}`);
		}
		const ws = parsed.data.workspaces ?? 0;
		return pass("readiness", "Runtime ready", `${ws} workspace(s)`);
	} catch (err: unknown) {
		return fl(
			"readiness",
			"Runtime ready",
			err instanceof Error ? err.message : String(err),
		);
	}
}

async function checkAuth(
	profile: { profile: Profile },
	hasCreds: boolean,
): Promise<CheckResult> {
	if (!hasCreds) {
		return warn(
			"auth",
			"Auth credentials",
			"no apiKey or oidc token stored",
			"Run `aiw login` (API key) or `aiw login --oidc`.",
		);
	}
	try {
		const me = await request(
			{ profile: profile.profile },
			"/auth/me",
			WhoAmISchema,
		);
		const scopes = me.scopes?.join(",") ?? "(none)";
		return pass("auth", "Auth credentials", `scopes: ${scopes}`);
	} catch (err: unknown) {
		if (err instanceof HttpError) {
			return fl(
				"auth",
				"Auth credentials",
				`${err.code}: ${err.message}`,
				err.hint,
				err.docs,
			);
		}
		return fl("auth", "Auth credentials", String(err));
	}
}

async function checkMcp(url: string): Promise<CheckResult> {
	const data = await probeJson(url, "/features", FeaturesSchema);
	if (!data) return warn("mcp", "MCP", "could not read /features", undefined);
	if (data.mcp?.enabled === false) {
		return warn(
			"mcp",
			"MCP",
			"mcp.enabled is false",
			"Set `mcp.enabled: true` in workbench.yaml to expose the MCP façade.",
		);
	}
	return pass("mcp", "MCP", data.mcp?.baseUrl ? `at ${data.mcp.baseUrl}` : "");
}

async function checkAstraCli(url: string): Promise<CheckResult> {
	const data = await probeJson(url, "/astra-cli", AstraCliSchema);
	if (!data) return pass("astra-cli", "Astra CLI auto-discovery", "skipped");
	const status = data.status ?? "unknown";
	if (status === "discovered" && data.profile) {
		return pass(
			"astra-cli",
			"Astra CLI auto-discovery",
			`profile ${data.profile}`,
		);
	}
	if (status === "skipped") {
		return pass(
			"astra-cli",
			"Astra CLI auto-discovery",
			"skipped (no astra CLI)",
		);
	}
	return warn(
		"astra-cli",
		"Astra CLI auto-discovery",
		status,
		"Set ASTRA_PROFILE / ASTRA_DB or WORKBENCH_DISABLE_ASTRA_CLI=1 to silence.",
	);
}

async function runDoctor(profileName?: string): Promise<DoctorReport> {
	const loc = defaultConfigLocation();
	const config = await readConfig(loc);
	let resolvedProfileName: string | null = null;
	let url: string | null = null;
	let hasCreds = false;
	const checks: CheckResult[] = [];

	try {
		const resolved = resolveProfile(config, { profileName });
		resolvedProfileName = resolved.name;
		url = resolved.profile.url;
		hasCreds = Boolean(resolved.profile.apiKey || resolved.profile.oidc);
		checks.push(pass("profile", "Profile resolved", resolved.name));
	} catch (err: unknown) {
		checks.push(
			fl(
				"profile",
				"Profile resolved",
				err instanceof Error ? err.message : String(err),
				"Run `aiw login` to create a profile, then re-run `aiw doctor`.",
			),
		);
		return {
			profile: null,
			url: null,
			checks,
			summary: summarise(checks),
		};
	}

	checks.push(await checkRuntimeReachable(url));
	if (checks[checks.length - 1]?.status !== "fail") {
		checks.push(await checkReadiness(url));
		const stored = config.profiles[resolvedProfileName];
		const authProfile: Profile = stored ?? { url };
		checks.push(await checkAuth({ profile: authProfile }, hasCreds));
		checks.push(await checkMcp(url));
		checks.push(await checkAstraCli(url));
	}

	return {
		profile: resolvedProfileName,
		url,
		checks,
		summary: summarise(checks),
	};
}

async function runExplain(
	code: string,
	format: OutputFormat,
	profileName?: string,
): Promise<number> {
	const config = await readConfig(defaultConfigLocation());
	let url: string | undefined;
	try {
		url = resolveProfile(config, { profileName }).profile.url;
	} catch {
		fail(
			`Cannot --explain without a profile. Run \`aiw login\` first, or pass --url.`,
		);
		return ExitCode.USAGE_ERROR;
	}
	const ctx = {
		profile: { url, apiKey: undefined as string | undefined },
	};
	try {
		const codes = await request(ctx, "/error-codes", ErrorCodesResponseSchema);
		const entry = codes.codes.find((c) => c.code === code);
		if (!entry) {
			fail(
				`Unknown error code "${code}". Run \`aiw doctor --explain\` without args to list.`,
			);
			return ExitCode.NOT_FOUND;
		}
		emit(
			format,
			entry,
			(e) =>
				`${pc.bold(e.code)}  ${pc.dim(`(default status ${e.defaultStatus})`)}\n${e.hint}\n${pc.dim(e.docs)}`,
		);
		return ExitCode.OK;
	} catch (err: unknown) {
		if (err instanceof HttpError) {
			fail(`Failed to fetch /error-codes: ${err.message}`, {
				hint: err.hint,
				docs: err.docs,
				requestId: err.requestId,
			});
		} else {
			fail(String(err));
		}
		return ExitCode.RUNTIME_ERROR;
	}
}

export const doctorCommand = defineCommand({
	meta: {
		name: "doctor",
		description:
			"Run pre-flight diagnostics against the active profile's runtime.",
	},
	args: {
		profile: { type: "string" },
		output: { type: "string", description: "human | json" },
		explain: {
			type: "string",
			description: "Print the registry entry for an error code, then exit.",
		},
	},
	async run({ args }) {
		const format = parseOutputFormat(args.output);
		if (args.explain) {
			const code = await runExplain(args.explain, format, args.profile);
			process.exit(code);
		}
		const report = await runDoctor(args.profile);
		emit(format, report, renderHuman);
		process.exit(exitCodeFor(report.summary));
	},
});
