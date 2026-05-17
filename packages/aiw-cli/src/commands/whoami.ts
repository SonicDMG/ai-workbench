import { defineCommand } from "citty";
import { loadContext } from "../context.js";
import { request } from "../http.js";
import { emit } from "../output.js";
import { WhoAmISchema } from "../types.js";

export const whoamiCommand = defineCommand({
	meta: {
		name: "whoami",
		description: "Show the subject the runtime sees for the active profile.",
	},
	args: {
		profile: { type: "string", description: "Profile to use" },
		url: { type: "string", description: "Override the runtime URL" },
		output: { type: "string", description: "Output format: human | json" },
	},
	async run({ args }) {
		const ctx = await loadContext(args);
		const me = await request(ctx.request, "/auth/me", WhoAmISchema);
		emit(ctx.output, me, (data) => {
			const lines: string[] = [];
			lines.push(`profile  ${ctx.resolved.name}`);
			lines.push(`url      ${ctx.resolved.profile.url}`);
			lines.push(`subject  ${JSON.stringify(data.subject ?? null)}`);
			if (Array.isArray(data.scopes)) {
				lines.push(`scopes   ${data.scopes.join(", ") || "(none)"}`);
			}
			return lines.join("\n");
		});
	},
});
