import { defineCommand } from "citty";
import {
	defaultConfigLocation,
	deleteProfile,
	readConfig,
	writeConfig,
} from "../config.js";
import { fail, success } from "../output.js";

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
	},
	async run({ args }) {
		const loc = defaultConfigLocation();
		const config = await readConfig(loc);
		const name = args.profile?.trim();

		if (name === "all") {
			await writeConfig({ active: undefined, profiles: {} }, loc);
			success("Cleared all profiles.");
			return;
		}

		const target = name || config.active;
		if (!target) {
			fail("No active profile, and no --profile given.");
			process.exit(2);
		}
		if (!config.profiles[target]) {
			fail(`Profile "${target}" not found.`);
			process.exit(2);
		}
		const next = deleteProfile(config, target);
		await writeConfig(next, loc);
		success(`Removed profile "${target}".`);
	},
});
