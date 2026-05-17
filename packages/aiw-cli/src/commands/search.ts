import { defineCommand } from "citty";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit, renderTable } from "../output.js";
import { SearchResponseSchema, type SearchResult } from "../types.js";

export const searchCommand = defineCommand({
	meta: {
		name: "search",
		description: "Search a knowledge base.",
	},
	args: {
		query: { type: "positional", required: true, description: "Search query" },
		workspace: { type: "string", description: "Workspace ID" },
		kb: { type: "string", description: "Knowledge base ID" },
		limit: { type: "string", description: "Max results (default 10)" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = args.workspace?.trim() || ctx.resolved.profile.defaultWorkspace;
		const kb = args.kb?.trim();
		if (!ws) throw new Error("--workspace is required.");
		if (!kb) throw new Error("--kb is required.");

		const limit = args.limit ? Number.parseInt(args.limit, 10) : 10;
		const body: Record<string, unknown> = { query: args.query, limit };
		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/knowledge-bases/${encodeURIComponent(kb)}/search`,
			SearchResponseSchema,
			{ method: "POST", body },
		);
		emit(ctx.output, res.data, (rows: SearchResult[]) =>
			renderTable(rows, [
				{ header: "SCORE", value: (r) => (r.score ?? 0).toFixed(4) },
				{ header: "DOCUMENT", value: (r) => r.documentId ?? "" },
				{
					header: "SNIPPET",
					value: (r) => truncate(r.snippet ?? r.text ?? "", 80),
				},
			]),
		);
	},
});

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}
