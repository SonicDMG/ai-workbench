/**
 * `aiw policy` — RLAC policy preview + audit log.
 *
 *  - `preview` POSTs a DSL fragment to `/policy/compile-preview` and
 *    surfaces the compiled Data API filter alongside any validation
 *    issues. Useful for iterating on a policy before flipping
 *    `rlacEnabled` on a workspace.
 *  - `audit` GETs `/policy/audit` and renders recent decisions
 *    (allow / deny / filter) so operators can see who saw what.
 *
 * See `docs/rlac.md` for the policy DSL and audit-log shape.
 */
import { defineCommand } from "citty";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit } from "../output.js";
import {
	PolicyAuditListSchema,
	type PolicyAuditRecord,
	type PolicyCompilePreview,
	PolicyCompilePreviewSchema,
} from "../types.js";

/**
 * Pure renderer for `policy preview`. Three layout branches:
 *
 *   1. Parse failed → `ok: false`, surface the parser error verbatim.
 *   2. Issues only → `ok: false`, list each `[code] message` (with
 *      optional `hint:` indented under it). No compiled filter block.
 *   3. Success → `ok: true`, principal, issues `(none)`, then a
 *      pretty-printed `compiled filter:` block.
 */
export function renderCompilePreview(r: PolicyCompilePreview): string {
	const lines: string[] = [];
	lines.push(`ok          ${r.ok ? "true" : "false"}`);
	lines.push(`principal   ${r.principalId ?? "(unbound)"}`);

	if (r.parseError) {
		lines.push(`parse error: ${r.parseError}`);
		return lines.join("\n");
	}

	if (r.issues.length === 0) {
		lines.push("issues:     (none)");
	} else {
		lines.push("issues:");
		for (const issue of r.issues) {
			lines.push(`  [${issue.code}] ${issue.message}`);
			if (issue.hint) {
				lines.push(`      hint: ${issue.hint}`);
			}
		}
	}

	if (r.compiledFilter !== null && r.compiledFilter !== undefined) {
		lines.push("compiled filter:");
		const pretty = JSON.stringify(r.compiledFilter, null, 2);
		for (const ln of pretty.split("\n")) {
			lines.push(`  ${ln}`);
		}
	}

	return lines.join("\n");
}

/**
 * Pure renderer for a single audit row. One line — designed for
 * scrolling through `aiw policy audit | less`.
 */
export function renderAuditRow(r: PolicyAuditRecord): string {
	const principal = r.principalId ?? "(none)";
	const resource = r.resourceId ?? "-";
	return `${r.ts}  ${r.decision.padEnd(6)}  ${r.action.padEnd(7)}  principal=${principal}  resource=${resource}  reason=${r.reason}`;
}

function renderAuditList(rows: readonly PolicyAuditRecord[]): string {
	if (rows.length === 0) return "(no decisions recorded)";
	return rows.map(renderAuditRow).join("\n");
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

const preview = defineCommand({
	meta: {
		name: "preview",
		description:
			"Parse, validate, and compile a policy DSL fragment. Optionally bind to a principal.",
	},
	args: {
		dsl: {
			type: "string",
			required: true,
			description:
				"Policy DSL fragment (e.g. \"owner_id = $principal.id OR '*' = ANY(visible_to)\")",
		},
		principal: {
			type: "string",
			description:
				"Principal id to bind for $principal.* / current_principal_id() resolution",
		},
		workspace: { type: "string", description: "Workspace ID" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = requireWorkspace(args, ctx.resolved.profile.defaultWorkspace);
		const body: Record<string, unknown> = { dsl: args.dsl };
		if (args.principal) body.principalId = args.principal;
		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/policy/compile-preview`,
			PolicyCompilePreviewSchema,
			{ method: "POST", body },
		);
		emit(ctx.output, res, renderCompilePreview);
	},
});

const auditList = defineCommand({
	meta: {
		name: "audit",
		description: "List recent RLAC decisions for a workspace.",
	},
	args: {
		principal: {
			type: "string",
			description: "Filter by principal id",
		},
		kb: {
			type: "string",
			description: "Filter by knowledge-base id",
		},
		day: {
			type: "string",
			description: "Filter by audit day (YYYY-MM-DD)",
		},
		limit: {
			type: "string",
			description: "Max rows (1-500, default per runtime)",
		},
		workspace: { type: "string", description: "Workspace ID" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = requireWorkspace(args, ctx.resolved.profile.defaultWorkspace);
		const query: Record<string, string | number | undefined> = {};
		if (args.principal) query.principalId = args.principal;
		if (args.kb) query.knowledgeBaseId = args.kb;
		if (args.day) query.auditDay = args.day;
		if (args.limit) {
			const n = Number(args.limit);
			if (!Number.isFinite(n) || n < 1) {
				throw new Error("--limit must be a positive integer.");
			}
			query.limit = n;
		}
		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/policy/audit`,
			PolicyAuditListSchema,
			{ query },
		);
		emit(ctx.output, res.items, renderAuditList);
	},
});

export const policyCommand = defineCommand({
	meta: {
		name: "policy",
		description:
			"Preview RLAC policies and inspect the audit log. See docs/rlac.md.",
	},
	subCommands: { preview, audit: auditList },
});
