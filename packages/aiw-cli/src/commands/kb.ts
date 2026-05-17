import { defineCommand } from "citty";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit, renderTable } from "../output.js";
import {
	type KnowledgeBase,
	KnowledgeBaseListSchema,
	KnowledgeBaseSchema,
} from "../types.js";

const sharedArgs = {
	workspace: {
		type: "string" as const,
		description: "Workspace ID (defaults to profile.defaultWorkspace)",
	},
	profile: { type: "string" as const },
	url: { type: "string" as const },
	output: { type: "string" as const, description: "human | json" },
};

function workspaceOf(
	ctx: { resolved: { profile: { defaultWorkspace?: string } } },
	flag?: string,
): string {
	const w = flag?.trim() || ctx.resolved.profile.defaultWorkspace;
	if (!w) {
		throw new Error(
			"--workspace is required (or set defaultWorkspace in your profile).",
		);
	}
	return w;
}

const list = defineCommand({
	meta: { name: "list", description: "List knowledge bases in a workspace." },
	args: sharedArgs,
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = workspaceOf(ctx, args.workspace);
		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/knowledge-bases`,
			KnowledgeBaseListSchema,
		);
		emit(ctx.output, res.items, (rows: KnowledgeBase[]) =>
			renderTable(rows, [
				{ header: "ID", value: (r) => r.knowledgeBaseId },
				{ header: "NAME", value: (r) => r.name },
				{ header: "STATUS", value: (r) => r.status ?? "" },
				{ header: "COLLECTION", value: (r) => r.vectorCollection ?? "" },
			]),
		);
	},
});

const create = defineCommand({
	meta: { name: "create", description: "Create a knowledge base." },
	args: {
		name: {
			type: "positional",
			required: true,
			description: "Knowledge base name",
		},
		...sharedArgs,
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = workspaceOf(ctx, args.workspace);
		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/knowledge-bases`,
			KnowledgeBaseSchema,
			{ method: "POST", body: { name: args.name } },
		);
		emit(
			ctx.output,
			res,
			(kb: KnowledgeBase) =>
				`Created knowledge base "${kb.name}" (${kb.knowledgeBaseId}).`,
		);
	},
});

export const kbCommand = defineCommand({
	meta: { name: "kb", description: "Manage knowledge bases." },
	subCommands: { list, create },
});
