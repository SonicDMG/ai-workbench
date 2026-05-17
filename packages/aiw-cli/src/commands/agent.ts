import { defineCommand } from "citty";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit, renderTable } from "../output.js";
import { type Agent, AgentListSchema } from "../types.js";

const list = defineCommand({
	meta: { name: "list", description: "List agents in a workspace." },
	args: {
		workspace: { type: "string", description: "Workspace ID" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = args.workspace?.trim() || ctx.resolved.profile.defaultWorkspace;
		if (!ws) throw new Error("--workspace is required.");
		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/agents`,
			AgentListSchema,
		);
		emit(ctx.output, res.data, (rows: Agent[]) =>
			renderTable(rows, [
				{ header: "ID", value: (r) => r.id },
				{ header: "NAME", value: (r) => r.name },
				{ header: "PERSONA", value: (r) => r.persona ?? "" },
			]),
		);
	},
});

export const agentCommand = defineCommand({
	meta: { name: "agent", description: "Manage agents." },
	subCommands: { list },
});
