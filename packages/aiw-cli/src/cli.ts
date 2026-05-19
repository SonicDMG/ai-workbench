#!/usr/bin/env node
/**
 * `aiw` — AI Workbench command-line interface.
 *
 * Entrypoint for the npm-published binary. citty assembles the
 * command tree below; each subcommand lives in its own file under
 * `src/commands/`.
 */
import { defineCommand, runMain } from "citty";
import { agentCommand } from "./commands/agent.js";
import { chatCommand } from "./commands/chat.js";
import { dbCommand } from "./commands/db.js";
import { docCommand } from "./commands/doc.js";
import { jobCommand } from "./commands/job.js";
import { kbCommand } from "./commands/kb.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { searchCommand } from "./commands/search.js";
import { shimCommand } from "./commands/shim.js";
import { whoamiCommand } from "./commands/whoami.js";
import { workspaceCommand } from "./commands/workspace.js";
import { HttpError } from "./http.js";
import { fail } from "./output.js";
import { VERSION } from "./version.js";

const main = defineCommand({
	meta: {
		name: "aiw",
		version: VERSION,
		description:
			"Command-line interface for AI Workbench (https://github.com/datastax/ai-workbench).",
	},
	subCommands: {
		login: loginCommand,
		logout: logoutCommand,
		whoami: whoamiCommand,
		workspace: workspaceCommand,
		kb: kbCommand,
		db: dbCommand,
		doc: docCommand,
		search: searchCommand,
		agent: agentCommand,
		chat: chatCommand,
		job: jobCommand,
		shim: shimCommand,
	},
});

runMain(main).catch((err: unknown) => {
	if (err instanceof HttpError) {
		fail(`${err.code}: ${err.message}`);
		process.exit(typeof err.status === "number" && err.status >= 400 ? 1 : 2);
	}
	if (err instanceof Error) {
		fail(err.message);
		process.exit(1);
	}
	fail(String(err));
	process.exit(1);
});
