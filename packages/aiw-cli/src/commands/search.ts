import { defineCommand } from "citty";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit, renderTable } from "../output.js";
import { type SearchHit, SearchResponseSchema } from "../types.js";

export const searchCommand = defineCommand({
	meta: {
		name: "search",
		description: "Search a knowledge base.",
	},
	args: {
		query: { type: "positional", required: true, description: "Search query" },
		workspace: {
			type: "string",
			description: "Workspace ID (defaults to profile.defaultWorkspace)",
		},
		kb: { type: "string", description: "Knowledge base ID" },
		"top-k": {
			type: "string",
			description: "Max hits returned (default 10)",
		},
		hybrid: { type: "boolean", description: "Enable hybrid search" },
		rerank: { type: "boolean", description: "Enable reranking" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = args.workspace?.trim() || ctx.resolved.profile.defaultWorkspace;
		const kb = args.kb?.trim();
		if (!ws)
			throw new Error(
				"--workspace is required (or set defaultWorkspace in your profile).",
			);
		if (!kb) throw new Error("--kb is required.");

		const topK = args["top-k"] ? Number.parseInt(args["top-k"], 10) : 10;
		const body: Record<string, unknown> = { text: args.query, topK };
		if (args.hybrid) body.hybrid = true;
		if (args.rerank) body.rerank = true;
		const hits = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/knowledge-bases/${encodeURIComponent(kb)}/search`,
			SearchResponseSchema,
			{ method: "POST", body },
		);
		emit(ctx.output, hits, (rows: SearchHit[]) =>
			renderTable(rows, [
				{ header: "SCORE", value: (r) => r.score.toFixed(4) },
				{ header: "CHUNK", value: (r) => r.id },
				{ header: "TEXT", value: (r) => truncate(extractText(r), 80) },
			]),
		);
	},
});

function extractText(hit: SearchHit): string {
	const p = hit.payload;
	if (!p) return "";
	for (const key of ["chunk_text", "text", "content"]) {
		const v = p[key];
		if (typeof v === "string") return v;
	}
	return "";
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}
