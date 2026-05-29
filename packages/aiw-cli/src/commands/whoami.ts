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
			if (data.id) lines.push(`subject  ${data.id}`);
			if (data.label) lines.push(`label    ${data.label}`);
			if (data.type) lines.push(`type     ${data.type}`);
			// RBAC (0.4.0): the runtime reports the caller's effective role
			// + privilege scopes. `null` for either means "unscoped" — an
			// OIDC subject with no role mapping carries every scope.
			if (data.role !== undefined) {
				lines.push(`role     ${data.role ?? "(unscoped — all scopes)"}`);
			}
			if (data.scopes !== undefined) {
				lines.push(
					`scopes   ${
						data.scopes === null ? "(all)" : data.scopes.join(", ") || "(none)"
					}`,
				);
			}
			return lines.join("\n");
		});
	},
});
