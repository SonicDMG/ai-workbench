import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import {
	defaultConfigLocation,
	type Profile,
	readConfig,
	setProfile,
	writeConfig,
} from "../config.js";
import { request } from "../http.js";
import { fail, info, success } from "../output.js";
import { WhoAmISchema } from "../types.js";

export const loginCommand = defineCommand({
	meta: {
		name: "login",
		description: "Save an API key + runtime URL into a profile.",
	},
	args: {
		url: {
			type: "string",
			description: "Runtime base URL (e.g. http://localhost:8080)",
		},
		profile: {
			type: "string",
			description: "Profile name to write to (default: 'default')",
		},
		"api-key": {
			type: "string",
			description: "API key (prompted if omitted; reads stdin when piped)",
		},
		"no-verify": {
			type: "boolean",
			description: "Skip the call to /auth/me after saving credentials",
		},
	},
	async run({ args }) {
		const interactive = process.stdin.isTTY && !args["api-key"];

		const profileName =
			args.profile?.trim() ||
			(interactive
				? ((await p.text({
						message: "Profile name",
						placeholder: "default",
						defaultValue: "default",
					})) as string)
				: "default");

		const url =
			args.url?.trim() ||
			(interactive
				? ((await p.text({
						message: "Runtime URL",
						placeholder: "http://localhost:8080",
						validate: (v) => {
							if (!v) return "Runtime URL is required.";
							try {
								new URL(v);
								return undefined;
							} catch {
								return "Must be a valid URL.";
							}
						},
					})) as string)
				: undefined);

		if (!url) {
			fail("--url is required when stdin is not a TTY.");
			process.exit(2);
		}

		const apiKey =
			args["api-key"]?.trim() ||
			(interactive
				? ((await p.password({
						message: "API key (created in the workspace settings)",
						mask: "•",
					})) as string)
				: undefined);

		const profile: Profile = { url, apiKey };
		const loc = defaultConfigLocation();
		const current = await readConfig(loc);
		const next = setProfile(current, profileName, profile);
		await writeConfig(next, loc);
		success(`Saved profile "${profileName}" at ${loc.file}.`);

		if (args["no-verify"]) return;
		if (!apiKey) {
			info("No API key supplied; skipping /auth/me verification.");
			return;
		}

		try {
			await request({ profile }, "/auth/me", WhoAmISchema);
			success("API key accepted by the runtime.");
		} catch (err: unknown) {
			fail(
				`Saved the profile but /auth/me failed: ${describe(err)}. Run \`aiw whoami\` once the runtime is reachable.`,
			);
		}
	},
});

function describe(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
