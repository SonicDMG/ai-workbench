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
import { completionCommand } from "./commands/completion.js";
import { dbCommand } from "./commands/db.js";
import { docCommand } from "./commands/doc.js";
import { doctorCommand } from "./commands/doctor.js";
import { jobCommand } from "./commands/job.js";
import { kbCommand } from "./commands/kb.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { profileCommand } from "./commands/profile.js";
import { searchCommand } from "./commands/search.js";
import { shimCommand } from "./commands/shim.js";
import { statusCommand } from "./commands/status.js";
import { whoamiCommand } from "./commands/whoami.js";
import { workspaceCommand } from "./commands/workspace.js";
import { ConfigError } from "./config.js";
import { ExitCode, exitCodeForHttpError } from "./exit-codes.js";
import { HttpError } from "./http.js";
import { fail } from "./output.js";
import { buildCliTelemetry, commandNameFromArgv } from "./telemetry.js";
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
		profile: profileCommand,
		workspace: workspaceCommand,
		kb: kbCommand,
		db: dbCommand,
		doc: docCommand,
		search: searchCommand,
		agent: agentCommand,
		chat: chatCommand,
		job: jobCommand,
		shim: shimCommand,
		completion: completionCommand,
		doctor: doctorCommand,
		status: statusCommand,
	},
});

const telemetry = buildCliTelemetry({ version: VERSION });
telemetry.emit("command_run", { command: commandNameFromArgv(process.argv) });

runMain(main).catch((err: unknown) => {
	if (err instanceof HttpError) {
		fail(`${err.code}: ${err.message}`, {
			hint: err.hint,
			docs: err.docs,
			requestId: err.requestId,
		});
		const exit = exitCodeForHttpError(err.code, err.status);
		telemetry.emit("error", { code: err.code, exit });
		process.exit(exit);
	}
	if (err instanceof ConfigError) {
		fail(err.message);
		telemetry.emit("error", {
			code: "config_error",
			exit: ExitCode.USAGE_ERROR,
		});
		process.exit(ExitCode.USAGE_ERROR);
	}
	if (err instanceof Error) {
		fail(err.message);
		telemetry.emit("error", {
			code: "runtime_error",
			exit: ExitCode.RUNTIME_ERROR,
		});
		process.exit(ExitCode.RUNTIME_ERROR);
	}
	fail(String(err));
	telemetry.emit("error", {
		code: "unknown_error",
		exit: ExitCode.RUNTIME_ERROR,
	});
	process.exit(ExitCode.RUNTIME_ERROR);
});
