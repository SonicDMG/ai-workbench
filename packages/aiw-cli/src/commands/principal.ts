/**
 * `aiw principal` — RLAC sub-workspace identity CRUD.
 *
 * Principals are workspace-scoped strings (OIDC `sub`, an email
 * address, or an operator-chosen handle) that the policy DSL
 * evaluates against. See `docs/rlac.md` for the model. This file
 * wraps `/api/v1/workspaces/{w}/principals[/{id}]` — the routes the
 * UI already drives.
 */
import { defineCommand } from "citty";
import { z } from "zod";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit, renderTable } from "../output.js";
import {
	type Principal,
	PrincipalListSchema,
	PrincipalSchema,
} from "../types.js";

/**
 * Pure renderer for `principal list`. Extracted from `defineCommand`
 * so the human layout is unit-testable without the citty wrapper.
 */
export function renderPrincipalList(rows: readonly Principal[]): string {
	return renderTable(rows, [
		{ header: "ID", value: (r) => r.principalId },
		{ header: "LABEL", value: (r) => r.label ?? "" },
		{
			header: "ATTRIBUTES",
			value: (r) => formatAttributes(r.attributes),
		},
		{ header: "UPDATED", value: (r) => r.updatedAt ?? "" },
	]);
}

/**
 * Pure renderer for `principal get`. Mirrors the indented key-value
 * layout used by `aiw job status` so the surface feels consistent
 * across `aiw <thing> get`.
 */
export function renderPrincipal(p: Principal): string {
	const lines: string[] = [];
	lines.push(`id          ${p.principalId}`);
	if (p.label) lines.push(`label       ${p.label}`);
	lines.push(`attributes  ${formatAttributes(p.attributes)}`);
	if (p.createdAt) lines.push(`created     ${p.createdAt}`);
	if (p.updatedAt) lines.push(`updated     ${p.updatedAt}`);
	return lines.join("\n");
}

function formatAttributes(
	attrs: Readonly<Record<string, string>> | undefined,
): string {
	if (!attrs) return "(none)";
	const entries = Object.entries(attrs);
	if (entries.length === 0) return "(none)";
	// Sort by key so the output is stable across runs / store backends.
	return entries
		.slice()
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}=${v}`)
		.join(" ");
}

/**
 * `--attribute key=value` (repeatable). Citty parses repeated flags
 * into an array; a single occurrence comes in as a string. Pre-parse
 * so the rest of the command sees a flat `Record<string, string>`.
 */
function parseAttributes(
	raw: string | readonly string[] | undefined,
): Record<string, string> {
	if (!raw) return {};
	const items = Array.isArray(raw) ? raw : [raw as string];
	const out: Record<string, string> = {};
	for (const item of items) {
		const eq = item.indexOf("=");
		if (eq < 1) {
			throw new Error(
				`--attribute expects key=value (got "${item}"). Example: --attribute dept=eng`,
			);
		}
		out[item.slice(0, eq)] = item.slice(eq + 1);
	}
	return out;
}

function requireWorkspace(
	args: { workspace?: string },
	defaultWs: string | undefined,
): string {
	const ws = args.workspace?.trim() || defaultWs;
	if (!ws) {
		throw new Error(
			"--workspace is required (or set defaultWorkspace in your profile).",
		);
	}
	return ws;
}

const list = defineCommand({
	meta: {
		name: "list",
		description: "List principals in a workspace.",
	},
	args: {
		workspace: { type: "string", description: "Workspace ID" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = requireWorkspace(args, ctx.resolved.profile.defaultWorkspace);
		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/principals`,
			PrincipalListSchema,
		);
		emit(ctx.output, res.items, renderPrincipalList);
	},
});

const get = defineCommand({
	meta: { name: "get", description: "Show a single principal." },
	args: {
		id: { type: "positional", required: true, description: "Principal ID" },
		workspace: { type: "string", description: "Workspace ID" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = requireWorkspace(args, ctx.resolved.profile.defaultWorkspace);
		const p = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/principals/${encodeURIComponent(args.id)}`,
			PrincipalSchema,
		);
		emit(ctx.output, p, renderPrincipal);
	},
});

const create = defineCommand({
	meta: { name: "create", description: "Create a principal." },
	args: {
		id: { type: "positional", required: true, description: "Principal ID" },
		label: { type: "string", description: "Human-readable label" },
		attribute: {
			type: "string",
			description: "key=value attribute (repeatable: --attribute dept=eng)",
		},
		workspace: { type: "string", description: "Workspace ID" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = requireWorkspace(args, ctx.resolved.profile.defaultWorkspace);
		const attributes = parseAttributes(
			args.attribute as string | readonly string[] | undefined,
		);
		const body: Record<string, unknown> = { principalId: args.id };
		if (args.label !== undefined) body.label = args.label;
		if (Object.keys(attributes).length > 0) body.attributes = attributes;
		const created = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/principals`,
			PrincipalSchema,
			{ method: "POST", body },
		);
		emit(
			ctx.output,
			created,
			(p) => `Created principal "${p.principalId}".\n${renderPrincipal(p)}`,
		);
	},
});

const update = defineCommand({
	meta: { name: "update", description: "Update a principal." },
	args: {
		id: { type: "positional", required: true, description: "Principal ID" },
		label: { type: "string", description: "New label" },
		attribute: {
			type: "string",
			description: "key=value attribute (repeatable, replaces all)",
		},
		workspace: { type: "string", description: "Workspace ID" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = requireWorkspace(args, ctx.resolved.profile.defaultWorkspace);
		const body: Record<string, unknown> = {};
		if (args.label !== undefined) body.label = args.label;
		if (args.attribute !== undefined) {
			body.attributes = parseAttributes(
				args.attribute as string | readonly string[],
			);
		}
		if (Object.keys(body).length === 0) {
			throw new Error(
				"Nothing to update — pass at least one of --label or --attribute.",
			);
		}
		const updated = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/principals/${encodeURIComponent(args.id)}`,
			PrincipalSchema,
			{ method: "PATCH", body },
		);
		emit(ctx.output, updated, renderPrincipal);
	},
});

const remove = defineCommand({
	meta: { name: "delete", description: "Delete a principal." },
	args: {
		id: { type: "positional", required: true, description: "Principal ID" },
		workspace: { type: "string", description: "Workspace ID" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = requireWorkspace(args, ctx.resolved.profile.defaultWorkspace);
		// Runtime returns 204 No Content for a successful delete; the
		// shared `request()` helper parses an empty body as `undefined`,
		// so accept that explicitly. A future JSON envelope still slides
		// through `.passthrough()` without breaking the call site.
		await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/principals/${encodeURIComponent(args.id)}`,
			z.union([PrincipalSchema.partial().passthrough(), z.undefined()]),
			{ method: "DELETE" },
		);
		emit(
			ctx.output,
			{ principalId: args.id, deleted: true },
			() => `Deleted principal ${args.id}.`,
		);
	},
});

export const principalCommand = defineCommand({
	meta: {
		name: "principal",
		description:
			"Manage RLAC principals (workspace-scoped identities). See docs/rlac.md.",
	},
	subCommands: { list, get, create, update, delete: remove },
});
