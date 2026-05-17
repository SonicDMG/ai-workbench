import { defineCommand } from "citty";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit } from "../output.js";
import { type Job, JobSchema } from "../types.js";

const status = defineCommand({
	meta: { name: "status", description: "Show the status of an async job." },
	args: {
		id: { type: "positional", required: true, description: "Job ID" },
		workspace: { type: "string", description: "Workspace ID" },
		profile: { type: "string" },
		url: { type: "string" },
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = args.workspace?.trim() || ctx.resolved.profile.defaultWorkspace;
		if (!ws) throw new Error("--workspace is required.");
		const job = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/jobs/${encodeURIComponent(args.id)}`,
			JobSchema,
		);
		emit(ctx.output, job, (j: Job) => {
			const lines: string[] = [];
			lines.push(`id        ${j.jobId}`);
			if (j.kind) lines.push(`kind      ${j.kind}`);
			lines.push(`status    ${j.status ?? "unknown"}`);
			if (typeof j.processed === "number") {
				const total = j.total ?? null;
				lines.push(
					`progress  ${j.processed}${total !== null ? `/${total}` : ""}`,
				);
			}
			if (j.knowledgeBaseId) lines.push(`kb        ${j.knowledgeBaseId}`);
			if (j.documentId) lines.push(`document  ${j.documentId}`);
			if (j.createdAt) lines.push(`created   ${j.createdAt}`);
			if (j.updatedAt) lines.push(`updated   ${j.updatedAt}`);
			if (j.errorMessage) lines.push(`error     ${j.errorMessage}`);
			return lines.join("\n");
		});
	},
});

export const jobCommand = defineCommand({
	meta: { name: "job", description: "Inspect async jobs." },
	subCommands: { status },
});
