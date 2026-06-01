/**
 * `aiw key` — workspace API-key lifecycle (list / create / revoke).
 *
 * Wraps `/api/v1/workspaces/{w}/api-keys[/{keyId}]`. Minting prints the
 * plaintext token EXACTLY ONCE (the runtime only stores a scrypt digest),
 * so `key create` is the CLI sibling of the web reveal dialog. Scopes come
 * from a `--role` preset (viewer / editor / admin) OR one-or-more
 * repeatable `--scope` flags (the 0.5.0 fine grants) — the two are
 * mutually exclusive; omit both to let the server apply its default
 * (`read` + `write`).
 */
import { defineCommand } from "citty";
import { z } from "zod";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit, renderTable } from "../output.js";
import {
	type ApiKey,
	ApiKeyListSchema,
	ApiKeyRecordSchema,
	CreateApiKeyResponseSchema,
} from "../types.js";

/**
 * Role → scope presets. Mirrors the server's `auth/roles.ts` mapping and
 * the web create-key picker so `--role editor` mints the same key the UI
 * "Editor" preset does.
 */
const ROLE_SCOPES: Record<string, readonly string[]> = {
	viewer: ["read"],
	editor: ["read", "write"],
	admin: ["read", "write", "manage"],
};

/**
 * Pure renderer for `key list`. Extracted from `defineCommand` so the
 * human layout is unit-testable without the citty wrapper.
 */
export function renderKeyList(rows: readonly ApiKey[]): string {
	if (rows.length === 0) return "No API keys in this workspace.";
	return renderTable(rows, [
		{ header: "KEY ID", value: (r) => r.keyId },
		{ header: "LABEL", value: (r) => r.label },
		{ header: "PREFIX", value: (r) => `wb_live_${r.prefix}_…` },
		{ header: "SCOPES", value: (r) => r.scopes.join(" ") },
		{ header: "STATUS", value: (r) => (r.revokedAt ? "revoked" : "active") },
		{ header: "CREATED", value: (r) => r.createdAt ?? "" },
	]);
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

/**
 * Resolve the scope set from `--role` and/or repeatable `--scope`. The two
 * are mutually exclusive. Returns `undefined` when neither is supplied so
 * the create call omits `scopes` and the server applies its default.
 */
export function resolveScopes(args: {
	role?: string;
	scope?: string | readonly string[];
}): readonly string[] | undefined {
	const hasRole = args.role !== undefined && args.role !== "";
	const rawScopes =
		args.scope === undefined
			? []
			: Array.isArray(args.scope)
				? args.scope
				: [args.scope as string];
	if (hasRole && rawScopes.length > 0) {
		throw new Error(
			"--role and --scope are mutually exclusive — pass one or the other.",
		);
	}
	if (hasRole) {
		const preset = ROLE_SCOPES[args.role as string];
		if (!preset) {
			throw new Error(
				`Unknown --role '${args.role}'. Expected one of: ${Object.keys(ROLE_SCOPES).join(", ")}.`,
			);
		}
		return preset;
	}
	if (rawScopes.length > 0) return rawScopes;
	return undefined;
}

const list = defineCommand({
	meta: { name: "list", description: "List API keys in a workspace." },
	args: {
		workspace: {
			type: "string",
			description: "Workspace ID (defaults to profile.defaultWorkspace)",
		},
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = requireWorkspace(args, ctx.resolved.profile.defaultWorkspace);
		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/api-keys`,
			ApiKeyListSchema,
		);
		emit(ctx.output, res.items, renderKeyList);
	},
});

const create = defineCommand({
	meta: {
		name: "create",
		description:
			"Mint a workspace API key. Prints the plaintext token exactly once.",
	},
	args: {
		label: {
			type: "positional",
			required: true,
			description: "Human-readable label (e.g. ci, python-notebook)",
		},
		role: {
			type: "string",
			description:
				"Preset scope set: viewer (read) | editor (read+write) | admin (read+write+manage). Mutually exclusive with --scope.",
		},
		scope: {
			type: "string",
			description:
				"Fine scope to grant (repeatable: --scope read:content --scope write:ingest). Mutually exclusive with --role.",
		},
		workspace: {
			type: "string",
			description: "Workspace ID (defaults to profile.defaultWorkspace)",
		},
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = requireWorkspace(args, ctx.resolved.profile.defaultWorkspace);
		const scopes = resolveScopes({
			role: args.role,
			scope: args.scope as string | readonly string[] | undefined,
		});
		const body: Record<string, unknown> = { label: args.label };
		if (scopes !== undefined) body.scopes = [...scopes];
		const created = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/api-keys`,
			CreateApiKeyResponseSchema,
			{ method: "POST", body },
		);
		// Human form surfaces the once-only plaintext loudly; `--output json`
		// returns the full `{ plaintext, key }` object (also once-only).
		emit(ctx.output, created, (r) =>
			[
				`Created API key "${r.key.label}" (scopes: ${r.key.scopes.join(" ")}).`,
				"",
				"Plaintext token — shown ONCE, store it now (the runtime keeps only a digest):",
				`  ${r.plaintext}`,
			].join("\n"),
		);
	},
});

const revoke = defineCommand({
	meta: {
		name: "revoke",
		description: "Revoke an API key by its key id.",
	},
	args: {
		keyId: { type: "positional", required: true, description: "Key ID" },
		workspace: {
			type: "string",
			description: "Workspace ID (defaults to profile.defaultWorkspace)",
		},
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = requireWorkspace(args, ctx.resolved.profile.defaultWorkspace);
		// Runtime returns 204 No Content; the shared `request()` parses an
		// empty body as `undefined`. Accept that (a future JSON envelope
		// still slides through `.passthrough()`).
		await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/api-keys/${encodeURIComponent(args.keyId)}`,
			z.union([ApiKeyRecordSchema.partial().passthrough(), z.undefined()]),
			{ method: "DELETE" },
		);
		emit(
			ctx.output,
			{ keyId: args.keyId, revoked: true },
			() => `Revoked API key ${args.keyId}.`,
		);
	},
});

export const keyCommand = defineCommand({
	meta: {
		name: "key",
		description: "Manage workspace API keys (list / create / revoke).",
	},
	subCommands: { list, create, revoke },
});
