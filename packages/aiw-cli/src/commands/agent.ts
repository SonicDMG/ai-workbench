import { defineCommand } from "citty";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit, renderTable } from "../output.js";
import { type Agent, AgentListSchema } from "../types.js";

const list = defineCommand({
	meta: { name: "list", description: "List agents in a workspace." },
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
		const ws = args.workspace?.trim() || ctx.resolved.profile.defaultWorkspace;
		if (!ws)
			throw new Error(
				"--workspace is required (or set defaultWorkspace in your profile).",
			);
		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/agents`,
			AgentListSchema,
		);
		emit(ctx.output, res.items, (rows: Agent[]) =>
			renderTable(rows, [
				{ header: "ID", value: (r) => r.agentId },
				{ header: "NAME", value: (r) => r.name },
				{
					header: "DESCRIPTION",
					value: (r) => truncate(r.description ?? "", 60),
				},
			]),
		);
	},
});

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}

export const agentCommand = defineCommand({
	meta: { name: "agent", description: "Manage agents." },
	subCommands: { list },
});
