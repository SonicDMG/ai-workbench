/**
 * `aiw completion` — emit shell-completion scripts for the user's
 * shell of choice. Hand-rolled because citty ^0.2.2 (the pinned
 * version) doesn't ship a completion generator.
 *
 * Walks the top-level subcommand tree (one level deep — that's where
 * the discoverability win lives; per-flag completion is left for a
 * future iteration). The user sources the emitted script from their
 * shell rc file; see the README section for the one-liner.
 *
 * The list of subcommands and per-subcommand verbs is sourced from
 * the constant below rather than from the citty command tree at
 * runtime so the script remains a pure stdout dump (no need to
 * import / construct the full command graph just to print names).
 * Keep this list in sync with `src/cli.ts` when adding new commands.
 */
import { defineCommand } from "citty";
import { ExitCode } from "../exit-codes.js";
import { fail } from "../output.js";

type Shell = "bash" | "zsh" | "fish";

const SHELLS: ReadonlySet<Shell> = new Set(["bash", "zsh", "fish"]);

interface CommandSpec {
	readonly name: string;
	readonly summary: string;
	readonly subcommands?: readonly string[];
}

/**
 * Mirrors the subCommands record in `src/cli.ts`. Static so the
 * completion script generation stays a pure function of the
 * constant + the requested shell.
 */
const COMMANDS: readonly CommandSpec[] = [
	{ name: "login", summary: "Save credentials for a runtime." },
	{ name: "logout", summary: "Remove a stored profile." },
	{ name: "whoami", summary: "Show who the runtime thinks you are." },
	{
		name: "profile",
		summary: "Manage stored credential profiles.",
		subcommands: ["ls", "use", "rm"],
	},
	{
		name: "workspace",
		summary: "Workspaces CRUD.",
		subcommands: ["list", "create", "delete"],
	},
	{
		name: "kb",
		summary: "Knowledge-base CRUD.",
		subcommands: ["list", "create"],
	},
	{
		name: "db",
		summary: "Astra DB helpers.",
		subcommands: ["workbench", "ingest"],
	},
	{ name: "doc", summary: "Documents.", subcommands: ["upload"] },
	{ name: "search", summary: "Search a knowledge base." },
	{ name: "agent", summary: "Agents.", subcommands: ["list"] },
	{ name: "chat", summary: "Chat with an agent." },
	{ name: "job", summary: "Async jobs.", subcommands: ["status"] },
	{
		name: "shim",
		summary: "`astra` shim install helpers.",
		subcommands: ["path", "install"],
	},
	{ name: "completion", summary: "Print shell completion script." },
	{ name: "doctor", summary: "Run pre-flight diagnostics." },
	{ name: "status", summary: "Short health summary." },
];

function renderBash(): string {
	const verbs = COMMANDS.map((c) => c.name).join(" ");
	const cases = COMMANDS.filter((c) => c.subcommands?.length)
		.map(
			(c) =>
				`            ${c.name})
                COMPREPLY=( $(compgen -W "${(c.subcommands ?? []).join(" ")}" -- "$cur") )
                ;;`,
		)
		.join("\n");
	return `# aiw bash completion. Source from ~/.bashrc:
#   eval "$(aiw completion bash)"
_aiw() {
    local cur prev words cword
    _init_completion || return

    if [[ \${cword} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "${verbs}" -- "$cur") )
        return
    fi

    if [[ \${cword} -eq 2 ]]; then
        case "\${words[1]}" in
${cases}
        esac
    fi
}
complete -F _aiw aiw
`;
}

function renderZsh(): string {
	const lines: string[] = [];
	lines.push("#compdef aiw");
	lines.push("# aiw zsh completion. Source from ~/.zshrc:");
	lines.push('#   eval "$(aiw completion zsh)"');
	lines.push("_aiw() {");
	lines.push("    local -a verbs subverbs");
	lines.push("    verbs=(");
	for (const c of COMMANDS) {
		lines.push(`        '${c.name}:${escapeZsh(c.summary)}'`);
	}
	lines.push("    )");
	lines.push("    if (( CURRENT == 2 )); then");
	lines.push("        _describe -t commands 'aiw command' verbs");
	lines.push("        return");
	lines.push("    fi");
	lines.push("    if (( CURRENT == 3 )); then");
	lines.push('        case "$words[2]" in');
	for (const c of COMMANDS) {
		if (!c.subcommands?.length) continue;
		lines.push(`            ${c.name})`);
		lines.push("                subverbs=(");
		for (const sub of c.subcommands) {
			lines.push(`                    '${sub}'`);
		}
		lines.push("                )");
		lines.push(
			"                _describe -t subcommands 'subcommand' subverbs",
		);
		lines.push("                ;;");
	}
	lines.push("        esac");
	lines.push("    fi");
	lines.push("}");
	lines.push("compdef _aiw aiw");
	return `${lines.join("\n")}\n`;
}

function renderFish(): string {
	const out: string[] = [];
	out.push("# aiw fish completion. Save to:");
	out.push("#   ~/.config/fish/completions/aiw.fish");
	out.push("# or pipe directly:  aiw completion fish | source");
	out.push(
		"complete -c aiw -f -n '__fish_use_subcommand' -a '" +
			COMMANDS.map((c) => c.name).join(" ") +
			"'",
	);
	for (const c of COMMANDS) {
		out.push(
			`complete -c aiw -f -n '__fish_use_subcommand' -a '${c.name}' -d '${escapeFish(c.summary)}'`,
		);
		if (!c.subcommands?.length) continue;
		for (const sub of c.subcommands) {
			out.push(
				`complete -c aiw -f -n '__fish_seen_subcommand_from ${c.name}' -a '${sub}'`,
			);
		}
	}
	return `${out.join("\n")}\n`;
}

function escapeZsh(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/'/g, "'\\''").replace(/:/g, "\\:");
}

function escapeFish(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export const completionCommand = defineCommand({
	meta: {
		name: "completion",
		description:
			"Emit a shell-completion script. Source from your shell rc — see README.",
	},
	args: {
		shell: {
			type: "positional",
			required: true,
			description: "Target shell: bash, zsh, or fish.",
		},
	},
	run({ args }) {
		const shell = args.shell as Shell;
		if (!SHELLS.has(shell)) {
			fail(`Unknown shell "${args.shell}". Expected: bash, zsh, or fish.`);
			process.exit(ExitCode.USAGE_ERROR);
		}
		const script =
			shell === "bash"
				? renderBash()
				: shell === "zsh"
					? renderZsh()
					: renderFish();
		process.stdout.write(script);
	},
});
