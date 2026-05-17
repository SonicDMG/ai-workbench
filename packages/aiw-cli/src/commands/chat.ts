import { createInterface } from "node:readline/promises";
import { defineCommand } from "citty";
import pc from "picocolors";
import { z } from "zod";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { fail, info } from "../output.js";

const SendResponseSchema = z
	.object({
		message: z
			.object({
				role: z.string().optional(),
				content: z.string().optional(),
			})
			.passthrough()
			.optional(),
		conversation: z.object({ id: z.string() }).passthrough().optional(),
	})
	.passthrough();

const ConversationCreatedSchema = z.object({ id: z.string() }).passthrough();

export const chatCommand = defineCommand({
	meta: {
		name: "chat",
		description: "Open a chat session with an agent (Ctrl-D to exit).",
	},
	args: {
		workspace: { type: "string", description: "Workspace ID" },
		agent: { type: "string", description: "Agent ID" },
		conversation: {
			type: "string",
			description: "Existing conversation ID (creates a new one if omitted)",
		},
		profile: { type: "string" },
		url: { type: "string" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const ws = args.workspace?.trim() || ctx.resolved.profile.defaultWorkspace;
		const agent = args.agent?.trim();
		if (!ws) throw new Error("--workspace is required.");
		if (!agent) throw new Error("--agent is required.");

		let conversationId = args.conversation?.trim();
		if (!conversationId) {
			const created = await request(
				ctx.request,
				`/api/v1/workspaces/${encodeURIComponent(ws)}/agents/${encodeURIComponent(agent)}/conversations`,
				ConversationCreatedSchema,
				{ method: "POST", body: {} },
			);
			conversationId = created.id;
			info(`Started conversation ${conversationId}.`);
		}

		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		process.stdout.write(
			pc.dim(
				`Connected to agent ${agent} in workspace ${ws}. Type a message, blank line to send, Ctrl-D to quit.\n`,
			),
		);

		while (true) {
			let line: string;
			try {
				line = await rl.question(pc.cyan("you > "));
			} catch {
				break;
			}
			const text = line.trim();
			if (!text) continue;
			try {
				const res = await request(
					ctx.request,
					`/api/v1/workspaces/${encodeURIComponent(ws)}/agents/${encodeURIComponent(agent)}/conversations/${encodeURIComponent(conversationId)}/messages`,
					SendResponseSchema,
					{
						method: "POST",
						body: { role: "user", content: text },
					},
				);
				const reply = res.message?.content ?? "(no content)";
				process.stdout.write(`${pc.green("bot >")} ${reply}\n`);
			} catch (err: unknown) {
				fail(`message failed: ${describe(err)}`);
			}
		}
		rl.close();
	},
});

function describe(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
