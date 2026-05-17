import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { defineCommand } from "citty";
import type { z } from "zod";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit } from "../output.js";
import { DocumentSchema } from "../types.js";

const UploadResponseSchema = DocumentSchema.partial().passthrough();
type UploadResponse = z.infer<typeof UploadResponseSchema>;

const upload = defineCommand({
	meta: {
		name: "upload",
		description: "Upload a document into a knowledge base.",
	},
	args: {
		file: {
			type: "positional",
			required: true,
			description: "Path to the file to upload",
		},
		workspace: { type: "string", description: "Workspace ID" },
		kb: { type: "string", description: "Knowledge base ID" },
		title: { type: "string", description: "Optional display title" },
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

		const bytes = await readFile(args.file);
		const form = new FormData();
		form.append(
			"file",
			new Blob([bytes as unknown as ArrayBuffer]),
			basename(args.file),
		);
		if (args.title) form.append("title", args.title);

		const res = await request(
			ctx.request,
			`/api/v1/workspaces/${encodeURIComponent(ws)}/knowledge-bases/${encodeURIComponent(kb)}/ingest/file`,
			UploadResponseSchema,
			{ method: "POST", body: form },
		);
		emit(
			ctx.output,
			res,
			(d: UploadResponse) =>
				`Uploaded ${basename(args.file)} → document ${d.id ?? "(no id)"}.`,
		);
	},
});

export const docCommand = defineCommand({
	meta: { name: "doc", description: "Manage documents in a knowledge base." },
	subCommands: { upload },
});
