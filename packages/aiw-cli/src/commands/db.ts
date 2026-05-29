/**
 * `aiw db <verb> <db_name>` — Astra-DB-flavoured entry points.
 *
 * Mirrors the verb-first shape of the existing `astra db <verb> <db>`
 * CLI (e.g. `astra db cqlsh start my_db`) so the bundled `astra` shim
 * can route `astra db workbench …` and `astra db ingest …` straight
 * through to these commands without re-ordering arguments.
 *
 * Today the runtime addresses ingest by workspace + knowledge base,
 * not by Astra DB ID. The `<db_name>` positional is carried for CLI
 * symmetry and surfaced to the user; once the runtime can resolve a
 * DB → workspace it can become the canonical addressing.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { defineCommand } from "citty";
import { z } from "zod";
import { loadContext } from "../context.js";
import { buildUrl, request } from "../http.js";
import { emit, warn } from "../output.js";
import {
	DocumentSchema,
	type KnowledgeBase,
	KnowledgeBaseListSchema,
	type Workspace,
	WorkspaceListSchema,
} from "../types.js";

const IngestResponseSchema = z
	.object({
		document: DocumentSchema.optional(),
		chunks: z.number().optional(),
		job: z.object({ jobId: z.string().optional() }).passthrough().optional(),
		outcome: z.string().optional(),
	})
	.passthrough();

interface ResolvedWorkspace {
	readonly workspaceId: string;
	readonly matchedBy: "name" | "url-substring" | "id";
}

/**
 * Find the workspace that backs `dbName`. The runtime guarantees one
 * workspace per `(url, keyspace)` pair, so for the common case
 * (`workspace.name === <db_name>`) the lookup collapses to a single
 * match. Falls back to substring matches on the `url` field — which
 * for `astra-cli:<profile>:<dbId>:endpoint` references contains the
 * Astra DB UUID, letting users pass a UUID instead of a name.
 *
 * Returns null when there is no unambiguous match.
 */
function resolveWorkspace(
	items: readonly Workspace[],
	dbName: string,
): ResolvedWorkspace | null {
	const needle = dbName.toLowerCase();
	const byId = items.find((w) => w.workspaceId.toLowerCase() === needle);
	if (byId) return { workspaceId: byId.workspaceId, matchedBy: "id" };
	const byName = items.filter((w) => w.name.toLowerCase() === needle);
	if (byName.length === 1 && byName[0])
		return { workspaceId: byName[0].workspaceId, matchedBy: "name" };
	const byUrl = items.filter((w) =>
		(w.url ?? "").toLowerCase().includes(needle),
	);
	if (byUrl.length === 1 && byUrl[0])
		return { workspaceId: byUrl[0].workspaceId, matchedBy: "url-substring" };
	return null;
}

interface ResolvedKnowledgeBase {
	readonly knowledgeBaseId: string;
	readonly matchedBy: "id" | "name";
}

/**
 * Find a KB inside a workspace by either ID or name. Lookup is
 * case-insensitive on name; an exact ID match wins to handle the
 * edge case where a user named a KB after another KB's UUID.
 */
function resolveKnowledgeBase(
	items: readonly KnowledgeBase[],
	value: string,
): ResolvedKnowledgeBase | null {
	const needle = value.toLowerCase();
	const byId = items.find((k) => k.knowledgeBaseId.toLowerCase() === needle);
	if (byId) return { knowledgeBaseId: byId.knowledgeBaseId, matchedBy: "id" };
	const byName = items.filter((k) => k.name.toLowerCase() === needle);
	if (byName.length === 1 && byName[0])
		return { knowledgeBaseId: byName[0].knowledgeBaseId, matchedBy: "name" };
	return null;
}

const workbench = defineCommand({
	meta: {
		name: "workbench",
		description: "Print (or open) the Workbench UI URL for an Astra database.",
	},
	args: {
		db: {
			type: "positional",
			required: false,
			description: "Astra database name, ID, or workspace ID",
		},
		workspace: {
			type: "string",
			description:
				"Workspace ID to deep-link to (skips the name → workspace lookup)",
		},
		open: {
			type: "boolean",
			description: "Attempt to open the URL in the default browser",
		},
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const dbName = args.db?.trim();
		const explicitWs = args.workspace?.trim();
		const base = ctx.resolved.profile.url.replace(/\/+$/, "");

		let workspaceId: string | null = explicitWs ?? null;
		let matchedBy: ResolvedWorkspace["matchedBy"] | "flag" | null = explicitWs
			? "flag"
			: null;
		let lookupError: string | null = null;

		if (!workspaceId && dbName) {
			try {
				const res = await request(
					ctx.request,
					"/api/v1/workspaces",
					WorkspaceListSchema,
				);
				const match = resolveWorkspace(res.items, dbName);
				if (match) {
					workspaceId = match.workspaceId;
					matchedBy = match.matchedBy;
				}
			} catch (err: unknown) {
				lookupError = err instanceof Error ? err.message : String(err);
			}
		}

		const target = workspaceId
			? `${base}/workspaces/${encodeURIComponent(workspaceId)}`
			: dbName
				? buildUrl(ctx.resolved.profile.url, "/", { db: dbName })
				: ctx.resolved.profile.url;

		if (lookupError && ctx.output === "human") {
			warn(`workspace lookup failed: ${lookupError}; falling back to root.`);
		} else if (dbName && !workspaceId && ctx.output === "human") {
			warn(
				`no workspace matched "${dbName}"; falling back to root. Pass --workspace <id> to deep-link.`,
			);
		}

		if (args.open) {
			await openInBrowser(target);
		}

		emit(
			ctx.output,
			{
				db: dbName ?? null,
				workspaceId,
				matchedBy,
				url: target,
				opened: Boolean(args.open),
				lookupError,
			},
			(r) => {
				const label =
					r.workspaceId && r.db
						? `${r.db} (workspace ${r.workspaceId})`
						: (r.db ?? "(no db)");
				return r.opened
					? `Opening Workbench for ${label} → ${r.url}`
					: `Workbench for ${label} → ${r.url}`;
			},
		);
	},
});

const ingest = defineCommand({
	meta: {
		name: "ingest",
		description:
			"Upload a document into a knowledge base on an Astra database.",
	},
	args: {
		db: {
			type: "positional",
			required: false,
			description: "Astra database name or ID (context only today)",
		},
		file: { type: "string", description: "Path to the file to upload" },
		workspace: {
			type: "string",
			description: "Workspace ID (defaults to profile.defaultWorkspace)",
		},
		"knowledge-base": { type: "string", description: "Knowledge base ID" },
		kb: { type: "string", description: "Alias for --knowledge-base" },
		title: { type: "string", description: "Optional display title" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const filePath = args.file?.trim();
		if (!filePath) throw new Error("--file is required.");

		const dbName = args.db?.trim();
		const kbArg = args["knowledge-base"]?.trim() || args.kb?.trim();
		if (!kbArg) throw new Error("--knowledge-base (or --kb) is required.");

		let ws = args.workspace?.trim() || ctx.resolved.profile.defaultWorkspace;
		if (!ws) {
			if (!dbName) {
				throw new Error(
					"--workspace is required (or pass the Astra DB name as a positional so it can be resolved).",
				);
			}
			const res = await request(
				ctx.request,
				"/api/v1/workspaces",
				WorkspaceListSchema,
			);
			const match = resolveWorkspace(res.items, dbName);
			if (!match) {
				throw new Error(
					`could not resolve "${dbName}" to a workspace. Pass --workspace <id> to address it explicitly.`,
				);
			}
			ws = match.workspaceId;
			if (ctx.output === "human") {
				warn(
					`resolved db "${dbName}" → workspace ${ws} (by ${match.matchedBy}).`,
				);
			}
		}

		// KB names are far more ergonomic than UUIDs but the runtime
		// only addresses by ID. Always run the list lookup so a name OR
		// an ID both work; the lookup is one cheap GET.
		let kbId = kbArg;
		const kbList = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/knowledge-bases`,
			KnowledgeBaseListSchema,
		);
		const kbMatch = resolveKnowledgeBase(kbList.items, kbArg);
		if (kbMatch) {
			kbId = kbMatch.knowledgeBaseId;
			if (kbMatch.matchedBy === "name" && ctx.output === "human") {
				warn(`resolved kb "${kbArg}" → ${kbId}.`);
			}
		}
		// If no match, fall through with the raw value — the runtime's
		// own 404 surfaces a clearer "knowledge base not found" error
		// than a guess on the CLI side.

		const bytes = await readFile(filePath);
		const form = new FormData();
		form.append(
			"file",
			new Blob([bytes as unknown as ArrayBuffer]),
			basename(filePath),
		);
		if (args.title) form.append("title", args.title);
		if (dbName) form.append("astraDb", dbName);

		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/knowledge-bases/${encodeURIComponent(kbId)}/ingest/file`,
			IngestResponseSchema,
			{ method: "POST", body: form },
		);
		emit(ctx.output, res, (r) => {
			const file = basename(filePath);
			const dbSuffix = dbName ? ` [db=${dbName}]` : "";
			if (r.job?.jobId) {
				return `Queued ${file} → job ${r.job.jobId}${dbSuffix}. Run \`aiw job status ${r.job.jobId} --workspace ${ws}\` to follow.`;
			}
			if (r.document?.documentId) {
				return `Uploaded ${file} → document ${r.document.documentId}${r.chunks ? ` (${r.chunks} chunks)` : ""}${dbSuffix}.`;
			}
			return `Uploaded ${file}${dbSuffix}.`;
		});
	},
});

async function openInBrowser(url: string): Promise<void> {
	const { spawn } = await import("node:child_process");
	const cmd =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "cmd"
				: "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(cmd, args, {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
}

export const dbCommand = defineCommand({
	meta: {
		name: "db",
		description:
			"Astra-DB-scoped commands (workbench, ingest). Verb-first to match the `astra db <verb> <db>` shape.",
	},
	subCommands: { workbench, ingest },
});
