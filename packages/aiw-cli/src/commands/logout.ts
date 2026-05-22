import { defineCommand } from "citty";
import {
	defaultConfigLocation,
	deleteProfile,
	readConfig,
	writeConfig,
} from "../config.js";
import { ExitCode } from "../exit-codes.js";
import { emit, fail, parseOutputFormat, success } from "../output.js";

export const logoutCommand = defineCommand({
	meta: {
		name: "logout",
		description: "Remove a stored profile's credentials.",
	},
	args: {
		profile: {
			type: "string",
			description:
				"Profile to remove (default: the active one). Use 'all' to clear every profile.",
		},
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const format = parseOutputFormat(args.output);
		const loc = defaultConfigLocation();
		const config = await readConfig(loc);
		const name = args.profile?.trim();

		if (name === "all") {
			await writeConfig({ active: undefined, profiles: {} }, loc);
			if (format === "json") emit(format, { removed: "all" }, () => "");
			else success("Cleared all profiles.");
			return;
		}

		const target = name || config.active;
		if (!target) {
			fail("No active profile, and no --profile given.");
			process.exit(ExitCode.USAGE_ERROR);
		}
		if (!config.profiles[target]) {
			fail(`Profile "${target}" not found.`);
			process.exit(ExitCode.USAGE_ERROR);
		}
		const next = deleteProfile(config, target);
		await writeConfig(next, loc);
		if (format === "json") emit(format, { removed: target }, () => "");
		else success(`Removed profile "${target}".`);
	},
});
