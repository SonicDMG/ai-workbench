import { defineCommand } from "citty";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit, renderTable } from "../output.js";
import {
	type Workspace,
	WorkspaceListSchema,
	WorkspaceSchema,
} from "../types.js";

const list = defineCommand({
	meta: {
		name: "list",
		description: "List workspaces visible to the active profile.",
	},
	args: {
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const res = await request(
			ctx.request,
			"/api/v1/workspaces",
			WorkspaceListSchema,
		);
		emit(ctx.output, res.items, (rows: Workspace[]) =>
			renderTable(rows, [
				{ header: "ID", value: (r) => r.workspaceId },
				{ header: "NAME", value: (r) => r.name },
				{ header: "KIND", value: (r) => r.kind ?? "" },
				{ header: "RLAC", value: (r) => (r.rlacEnabled ? "on" : "off") },
			]),
		);
	},
});

const create = defineCommand({
	meta: { name: "create", description: "Create a workspace." },
	args: {
		name: { type: "positional", required: true, description: "Workspace name" },
		kind: {
			type: "string",
			description: "Workspace kind (defaults to memory)",
		},
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const body: Record<string, unknown> = { name: args.name };
		if (args.kind) body.kind = args.kind;
		const res = await request(
			ctx.request,
			"/api/v1/workspaces",
			WorkspaceSchema,
			{ method: "POST", body },
		);
		emit(
			ctx.output,
			res,
			(w: Workspace) => `Created workspace "${w.name}" (${w.workspaceId}).`,
		);
	},
});

const remove = defineCommand({
	meta: { name: "delete", description: "Delete a workspace." },
	args: {
		id: { type: "positional", required: true, description: "Workspace ID" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(args.id)}`,
			// Tolerate 204 / empty body alongside JSON envelopes; we only
			// surface the success line below.
			WorkspaceSchema.partial().passthrough(),
			{ method: "DELETE" },
		).catch((err) => {
			if (err?.code === "invalid_response") return undefined;
			throw err;
		});
		emit(
			ctx.output,
			{ workspaceId: args.id, deleted: true },
			() => `Deleted workspace ${args.id}.`,
		);
	},
});

export const workspaceCommand = defineCommand({
	meta: {
		name: "workspace",
		description: "Manage workspaces.",
	},
	subCommands: { list, create, delete: remove },
});
