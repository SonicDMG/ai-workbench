/**
 * `aiw shim` — install and locate the bundled `astra` shim.
 *
 * Two execution modes for `install`:
 *
 *   - default: actually performs the install. Picks a safe location
 *     (`~/.aiw/bin/astra` unless `--dir` overrides), backs up any
 *     pre-existing real `astra` at the target with an `.aiw-bak-…`
 *     suffix, creates the shim symlink, and prints any PATH hint
 *     needed to put the shim ahead of the real binary on lookup.
 *
 *   - `--print` / `--dry-run`: shows the steps without touching disk.
 *
 * `--replace` swaps in the shim at the *real* astra's current path
 * (e.g. `/opt/homebrew/bin/astra`) after renaming the original to
 * `<path>.real`. This is the "transparent takeover" mode — no PATH
 * juggling but brittle across Homebrew upgrades, so we warn.
 */
import {
	accessSync,
	existsSync,
	constants as fsConstants,
	lstatSync,
	mkdirSync,
	readlinkSync,
	renameSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { emit, parseOutputFormat } from "../output.js";

function resolveShimPath(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	// Both dist (dist/commands/shim.js) and src (src/commands/shim.ts)
	// resolve the same two-up walk to scripts/astra-shim.sh. Kept as a
	// list for symmetry with the layered-layout convention used
	// elsewhere in this package.
	const candidates = [resolve(here, "..", "..", "scripts", "astra-shim.sh")];
	for (const p of candidates) {
		if (existsSync(p)) return p;
	}
	return candidates[0] ?? resolve(here, "..", "..", "scripts", "astra-shim.sh");
}

function findRealAstra(shimPath: string): string | null {
	// Walk $PATH ourselves rather than shelling out — macOS still ships
	// bash 3.2 which doesn't accept `command -v -a`, and a manual walk
	// is portable across shells and stripped-down sandboxes alike.
	//
	// If the only `astra` on PATH is our shim, look for a `<path>.real`
	// companion — that's where prior `--replace` runs (or our own
	// applyPlan) parked the original binary. This makes the post-install
	// state self-discoverable on re-runs.
	let shimEncountered: string | null = null;
	for (const dir of pathParts()) {
		const candidate = `${dir.replace(/\/+$/, "")}/astra`;
		if (!existsSync(candidate)) continue;
		if (candidate === shimPath || isShimSymlink(candidate, shimPath)) {
			shimEncountered = shimEncountered ?? candidate;
			continue;
		}
		try {
			accessSync(candidate, fsConstants.X_OK);
		} catch {
			continue;
		}
		return candidate;
	}
	// Known-locations fallback is a courtesy for users whose PATH
	// doesn't expose /opt/homebrew/bin (e.g. a stripped login shell).
	// Tests opt out via $AIW_SHIM_NO_KNOWN_LOCATIONS so the host's
	// homebrew install can't leak in.
	if (!process.env.AIW_SHIM_NO_KNOWN_LOCATIONS) {
		for (const p of ["/opt/homebrew/bin/astra", "/usr/local/bin/astra"]) {
			if (!existsSync(p)) continue;
			if (p === shimPath || isShimSymlink(p, shimPath)) {
				shimEncountered = shimEncountered ?? p;
				continue;
			}
			return p;
		}
	}
	if (shimEncountered) {
		const sibling = `${shimEncountered}.real`;
		if (existsSync(sibling)) return sibling;
	}
	return null;
}

function isShimSymlink(path: string, shimPath: string): boolean {
	try {
		const st = lstatSync(path);
		if (!st.isSymbolicLink()) return false;
		const target = readlinkSync(path);
		const resolved = target.startsWith("/")
			? target
			: resolve(dirname(path), target);
		return resolved === shimPath;
	} catch {
		return false;
	}
}

function pathParts(): string[] {
	return (process.env.PATH ?? "").split(":").filter(Boolean);
}

interface PathAdvice {
	readonly onPath: boolean;
	readonly aheadOfReal: boolean;
}

function adviseAboutPath(
	installDir: string,
	realAstra: string | null,
): PathAdvice {
	const parts = pathParts();
	const installIdx = parts.indexOf(installDir);
	if (installIdx === -1) return { onPath: false, aheadOfReal: false };
	if (!realAstra) return { onPath: true, aheadOfReal: true };
	const realDir = dirname(realAstra);
	const realIdx = parts.indexOf(realDir);
	if (realIdx === -1) return { onPath: true, aheadOfReal: true };
	return { onPath: true, aheadOfReal: installIdx < realIdx };
}

interface InstallPlan {
	readonly shimPath: string;
	readonly target: string;
	readonly mode: "fresh" | "already-shim" | "back-up-existing" | "replace-real";
	readonly backup?: string;
	readonly realAstra: string | null;
	readonly pathAdvice: PathAdvice;
}

function planInstall(opts: {
	shimPath: string;
	dir?: string;
	replace: boolean;
}): InstallPlan {
	const realAstra = findRealAstra(opts.shimPath);
	let target: string;
	if (opts.replace) {
		if (!realAstra) {
			throw new Error(
				"--replace requires an existing `astra` binary on PATH; none found.",
			);
		}
		target = realAstra;
	} else {
		const dir = (opts.dir?.trim() || join(homedir(), ".aiw", "bin")).replace(
			/\/+$/,
			"",
		);
		target = `${dir}/astra`;
	}

	let mode: InstallPlan["mode"] = "fresh";
	let backup: string | undefined;
	if (existsSync(target)) {
		if (isShimSymlink(target, opts.shimPath)) {
			mode = "already-shim";
		} else if (opts.replace) {
			mode = "replace-real";
			backup = `${target}.real`;
		} else {
			mode = "back-up-existing";
			const ts = new Date().toISOString().replace(/[:.]/g, "-");
			backup = `${target}.aiw-bak-${ts}`;
		}
	}

	const pathAdvice = adviseAboutPath(dirname(target), realAstra);
	return {
		shimPath: opts.shimPath,
		target,
		mode,
		backup,
		realAstra,
		pathAdvice,
	};
}

function applyPlan(plan: InstallPlan): void {
	if (plan.mode === "already-shim") return;
	mkdirSync(dirname(plan.target), { recursive: true });
	if (plan.backup) {
		if (existsSync(plan.backup)) {
			throw new Error(
				`Refusing to overwrite existing backup at ${plan.backup}. Move or delete it and retry.`,
			);
		}
		renameSync(plan.target, plan.backup);
	} else if (existsSync(plan.target)) {
		// Stale symlink (target gone, but lstat says it exists) — unlink
		// before symlinking. existsSync follows symlinks, so a broken
		// symlink hits the `else if` branch via lstat below.
		try {
			unlinkSync(plan.target);
		} catch {
			// fall through; symlink() will surface a clearer EEXIST
		}
	} else {
		try {
			lstatSync(plan.target);
			unlinkSync(plan.target);
		} catch {
			// not a dangling symlink either; nothing to clean up
		}
	}
	symlinkSync(plan.shimPath, plan.target);
}

function renderPlan(plan: InstallPlan, applied: boolean): string {
	const lines: string[] = [];
	const verb = applied ? "Installed" : "Would install";
	if (plan.mode === "already-shim") {
		lines.push(`Shim already installed at ${plan.target}.`);
	} else {
		lines.push(`${verb} shim → ${plan.target}`);
		if (plan.backup) {
			const action = applied ? "Backed up" : "Would back up";
			lines.push(`  ${action} existing file → ${plan.backup}`);
		}
	}
	if (plan.realAstra) {
		lines.push(`Real astra binary: ${plan.realAstra}`);
		lines.push(
			`  export ASTRA_REAL_BIN="${plan.realAstra}"  # optional, makes routing explicit`,
		);
	} else {
		lines.push("No real `astra` binary found on PATH.");
		lines.push(
			"  (The shim still serves `astra db workbench` / `astra db ingest`; other commands will error.)",
		);
	}
	if (plan.mode === "replace-real") {
		lines.push(
			"Note: `--replace` swaps the binary in-place. `brew upgrade astra` will overwrite this; re-run `aiw shim install --replace` after upgrades.",
		);
	}
	// In --replace mode the shim sits at the same path the real astra
	// used to live at, so PATH ordering against itself isn't meaningful.
	if (plan.mode === "replace-real") return lines.join("\n");
	const dir = dirname(plan.target);
	if (!plan.pathAdvice.onPath) {
		lines.push("");
		lines.push(
			`Add ${dir} to PATH so the shim is found before the real astra:`,
		);
		lines.push(`  echo 'export PATH="${dir}:$PATH"' >> ~/.zshrc`);
		lines.push("  # then start a new shell, or `source ~/.zshrc`");
	} else if (!plan.pathAdvice.aheadOfReal) {
		lines.push("");
		lines.push(
			`${dir} is on PATH but after the real astra's dir; reorder so it comes first.`,
		);
	}
	return lines.join("\n");
}

const path = defineCommand({
	meta: {
		name: "path",
		description: "Print the absolute path of the bundled `astra` shim.",
	},
	args: {
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const shimPath = resolveShimPath();
		const exists = existsSync(shimPath);
		emit(
			parseOutputFormat(args.output),
			{ path: shimPath, exists },
			(r) => r.path,
		);
	},
});

const install = defineCommand({
	meta: {
		name: "install",
		description:
			"Install the `astra` shim as a symlink. Backs up any existing real astra.",
	},
	args: {
		dir: {
			type: "string",
			description:
				"Directory to put the shim in (default: ~/.aiw/bin). Ignored with --replace.",
		},
		replace: {
			type: "boolean",
			description:
				"Replace the existing real `astra` in-place (backs up to `<path>.real`).",
		},
		print: {
			type: "boolean",
			description: "Show what would happen without touching disk.",
		},
		"dry-run": {
			type: "boolean",
			description: "Alias for --print.",
		},
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const shimPath = resolveShimPath();
		const dryRun = Boolean(args.print || args["dry-run"]);
		const plan = planInstall({
			shimPath,
			dir: args.dir,
			replace: Boolean(args.replace),
		});

		let applied = false;
		if (!dryRun) {
			applyPlan(plan);
			applied = plan.mode !== "already-shim";
		}

		emit(
			parseOutputFormat(args.output),
			{
				shim: plan.shimPath,
				target: plan.target,
				mode: plan.mode,
				backup: plan.backup ?? null,
				realAstra: plan.realAstra,
				applied,
				dryRun,
				pathOnPath: plan.pathAdvice.onPath,
				pathAheadOfReal: plan.pathAdvice.aheadOfReal,
			},
			() => renderPlan(plan, applied),
		);
	},
});

export const shimCommand = defineCommand({
	meta: {
		name: "shim",
		description:
			"Locate or install the bundled `astra` shim that adds workbench verbs.",
	},
	subCommands: { path, install },
});
