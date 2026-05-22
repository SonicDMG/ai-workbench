/**
 * `aiw profile` — manage stored credential profiles.
 *
 * Read-only `ls` doubles as the "what profiles do I have, and which
 * is active?" command (`whoami` reports what the runtime sees; this
 * reports what the CLI thinks). `use` and `rm` mutate the active
 * config file in-place. None of these subcommands hit the network.
 */
import { defineCommand } from "citty";
import {
	type Config,
	defaultConfigLocation,
	deleteProfile,
	readConfig,
	writeConfig,
} from "../config.js";
import { ExitCode } from "../exit-codes.js";
import {
	emit,
	fail,
	parseOutputFormat,
	renderTable,
	success,
} from "../output.js";

interface ProfileRow {
	readonly name: string;
	readonly active: boolean;
	readonly url: string;
	readonly auth: "apikey" | "oidc" | "none";
	readonly defaultWorkspace: string | null;
}

function listProfiles(config: Config): ProfileRow[] {
	return Object.entries(config.profiles)
		.map(([name, profile]): ProfileRow => {
			const auth: ProfileRow["auth"] = profile.oidc
				? "oidc"
				: profile.apiKey
					? "apikey"
					: "none";
			return {
				name,
				active: config.active === name,
				url: profile.url,
				auth,
				defaultWorkspace: profile.defaultWorkspace ?? null,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

const ls = defineCommand({
	meta: {
		name: "ls",
		description: "List stored profiles and mark the active one.",
	},
	args: {
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const format = parseOutputFormat(args.output);
		const loc = defaultConfigLocation();
		const config = await readConfig(loc);
		const rows = listProfiles(config);
		emit(format, { active: config.active ?? null, profiles: rows }, () =>
			rows.length === 0
				? "(no profiles — run `aiw login` to create one)"
				: renderTable(rows, [
						{ header: "", value: (r) => (r.active ? "*" : " ") },
						{ header: "NAME", value: (r) => r.name },
						{ header: "URL", value: (r) => r.url },
						{ header: "AUTH", value: (r) => r.auth },
						{
							header: "DEFAULT-WS",
							value: (r) => r.defaultWorkspace ?? "",
						},
					]),
		);
	},
});

const use = defineCommand({
	meta: {
		name: "use",
		description: "Set the active profile.",
	},
	args: {
		name: {
			type: "positional",
			required: true,
			description: "Profile name to activate",
		},
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const format = parseOutputFormat(args.output);
		const loc = defaultConfigLocation();
		const config = await readConfig(loc);
		if (!config.profiles[args.name]) {
			fail(`Profile "${args.name}" not found.`, {
				hint: "Run `aiw profile ls` to see what's stored, or `aiw login --profile <name>` to create it.",
			});
			process.exit(ExitCode.NOT_FOUND);
		}
		const next: Config = { ...config, active: args.name };
		await writeConfig(next, loc);
		if (format === "json") {
			emit(format, { active: args.name }, () => "");
		} else {
			success(`Active profile is now "${args.name}".`);
		}
	},
});

const rm = defineCommand({
	meta: {
		name: "rm",
		description: "Delete a stored profile.",
	},
	args: {
		name: {
			type: "positional",
			required: true,
			description: "Profile name to delete",
		},
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const format = parseOutputFormat(args.output);
		const loc = defaultConfigLocation();
		const config = await readConfig(loc);
		if (!config.profiles[args.name]) {
			fail(`Profile "${args.name}" not found.`);
			process.exit(ExitCode.NOT_FOUND);
		}
		const next = deleteProfile(config, args.name);
		await writeConfig(next, loc);
		if (format === "json") {
			emit(format, { removed: args.name }, () => "");
		} else {
			success(`Removed profile "${args.name}".`);
		}
	},
});

export const profileCommand = defineCommand({
	meta: {
		name: "profile",
		description: "List, switch, or remove stored credential profiles.",
	},
	subCommands: { ls, use, rm },
});
