/**
 * `aiw status` — short health summary for the active profile.
 *
 * Always-network-light counterpart to `doctor`: hits `/version`,
 * `/readyz`, and `/features` and prints a single-line per fact. No
 * remediation, no exit-code categorisation beyond "could I reach
 * the runtime?" — for the full diagnostic, run `aiw doctor`.
 */
import { defineCommand } from "citty";
import pc from "picocolors";
import { z } from "zod";
import {
	defaultConfigLocation,
	readConfig,
	resolveProfile,
} from "../config.js";
import { ExitCode } from "../exit-codes.js";
import { emit, fail, parseOutputFormat } from "../output.js";

export const VersionSchema = z
	.object({
		version: z.string().optional(),
		commit: z.string().optional(),
	})
	.passthrough();

export const ReadySchema = z
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

export const FeaturesSchema = z
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

export interface StatusReport {
	readonly profile: string;
	readonly url: string;
	readonly reachable: boolean;
	readonly version: string | null;
	readonly ready: boolean;
	readonly workspaces: number | null;
	readonly ingest: {
		readonly active: number;
		readonly queued: number;
		readonly capacity: number;
	} | null;
	readonly mcpEnabled: boolean | null;
	readonly mcpUrl: string | null;
}

export async function probe<T>(
	url: string,
	path: string,
	schema: z.ZodType<T>,
	fetchImpl: typeof fetch = fetch,
): Promise<T | null> {
	try {
		const res = await fetchImpl(`${url.replace(/\/+$/, "")}${path}`, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(5000),
		});
		const body = await res.json().catch(() => null);
		if (body === null) return null;
		const parsed = schema.safeParse(body);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function renderHuman(r: StatusReport): string {
	if (!r.reachable) {
		return `${pc.red("✗")} ${r.url} unreachable`;
	}
	const ingest = r.ingest
		? `${r.ingest.active}/${r.ingest.capacity} active, ${r.ingest.queued} queued`
		: "n/a";
	const mcp =
		r.mcpEnabled === null ? "?" : r.mcpEnabled ? (r.mcpUrl ?? "on") : "off";
	return [
		`${pc.green("✓")} ${r.url}`,
		`  version:    ${r.version ?? "?"}`,
		`  ready:      ${r.ready ? "yes" : pc.yellow("no")}`,
		`  workspaces: ${r.workspaces ?? "?"}`,
		`  ingest:     ${ingest}`,
		`  mcp:        ${mcp}`,
	].join("\n");
}

/**
 * Pure shape-assembly. Pulled out of the citty `run` so a unit test
 * can exercise the (version, ready, features) → StatusReport mapping
 * without spawning the binary or stubbing `process.exit`.
 */
export function buildStatusReport(input: {
	profile: string;
	url: string;
	version: z.infer<typeof VersionSchema> | null;
	ready: z.infer<typeof ReadySchema> | null;
	features: z.infer<typeof FeaturesSchema> | null;
}): StatusReport {
	const reachable = input.version !== null;
	return {
		profile: input.profile,
		url: input.url,
		reachable,
		version: input.version?.version ?? null,
		ready: input.ready?.status === "ready",
		workspaces: input.ready?.workspaces ?? null,
		ingest:
			input.ready?.ingest && typeof input.ready.ingest.capacity === "number"
				? {
						active: input.ready.ingest.active ?? 0,
						queued: input.ready.ingest.queued ?? 0,
						capacity: input.ready.ingest.capacity,
					}
				: null,
		mcpEnabled: input.features?.mcp?.enabled ?? null,
		mcpUrl: input.features?.mcp?.baseUrl ?? null,
	};
}

export const statusCommand = defineCommand({
	meta: {
		name: "status",
		description: "Short health summary for the active profile's runtime.",
	},
	args: {
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const format = parseOutputFormat(args.output);
		const config = await readConfig(defaultConfigLocation());
		const resolved = (() => {
			try {
				return resolveProfile(config, {
					profileName: args.profile,
					url: args.url,
				});
			} catch (err: unknown) {
				fail(err instanceof Error ? err.message : String(err));
				process.exit(ExitCode.USAGE_ERROR);
			}
		})();
		const url = resolved.profile.url;
		const [version, ready, features] = await Promise.all([
			probe(url, "/version", VersionSchema),
			probe(url, "/readyz", ReadySchema),
			probe(url, "/features", FeaturesSchema),
		]);
		const report = buildStatusReport({
			profile: resolved.name,
			url,
			version,
			ready,
			features,
		});
		emit(format, report, renderHuman);
		process.exit(report.reachable ? ExitCode.OK : ExitCode.UNAVAILABLE);
	},
});
