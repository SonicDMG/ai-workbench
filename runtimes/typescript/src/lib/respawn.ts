/**
 * Self-respawn helper for `/setup/restart`.
 *
 * In container deployments (Docker, k8s) the runtime runs as PID 1
 * and the container's restart policy (`restart: unless-stopped` /
 * `restartPolicy: Always`) brings it back when the process exits.
 * The graceful-shutdown handler in `root.ts` just SIGTERMs itself,
 * the orchestrator handles the rest.
 *
 * In dev (`node dist/root.js`, `npm run dev`, `tsx watch`) there is
 * no orchestrator. SIGTERM kills the process and nothing comes
 * back, so `/setup/restart` is a one-way trip — the operator pastes
 * corrected credentials, hits Save, the page polls `/readyz`
 * forever, and the spinner times out.
 *
 * This helper detects "no orchestrator" mode and spawns a detached
 * child process with the same argv + env before draining. The
 * child becomes the new runtime; the parent drains and exits as
 * usual. In container mode, we skip the spawn — the orchestrator
 * already does this and a stray detached child would just die when
 * the container tears down.
 */

import { type ChildProcess, spawn } from "node:child_process";

export interface RespawnPlan {
	/** Why we chose to skip / proceed. Goes to logs. */
	readonly mode: "container" | "spawn";
	/** Reason copy for the log line. */
	readonly reason: string;
}

export interface RespawnEnvironment {
	readonly pid: number;
	readonly containerEnv: NodeJS.ProcessEnv;
}

/**
 * Decide whether to self-respawn or defer to a container orchestrator.
 *
 * Heuristic:
 *   - PID 1 → almost certainly Docker / k8s → orchestrator handles
 *     restart, we just exit.
 *   - `WORKBENCH_DISABLE_SELF_RESPAWN=1` → operator override (CI,
 *     systemd unit with `Restart=on-failure`, etc.).
 *   - Otherwise → spawn a detached child so dev runs come back.
 */
export function planRespawn(env: RespawnEnvironment): RespawnPlan {
	if (env.pid === 1) {
		return {
			mode: "container",
			reason:
				"running as PID 1 — letting container restart policy bring us back",
		};
	}
	if (env.containerEnv.WORKBENCH_DISABLE_SELF_RESPAWN === "1") {
		return {
			mode: "container",
			reason: "WORKBENCH_DISABLE_SELF_RESPAWN=1 — assuming external supervisor",
		};
	}
	return {
		mode: "spawn",
		reason:
			"no orchestrator detected — spawning a detached child before draining",
	};
}

/**
 * Build the spawn arguments that would re-create the current
 * process. Separate from `executeRespawn` so unit tests can pin the
 * shape without actually forking.
 */
export function buildRespawnArgs(args: {
	readonly execPath: string;
	readonly execArgv: readonly string[];
	readonly argv: readonly string[];
	readonly cwd: string;
}): {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
} {
	// process.argv = [node, script, ...userArgs]. Drop the leading
	// `node` (we re-add it as the command) and keep the rest.
	const [, ...rest] = args.argv;
	const fullArgs = [...args.execArgv, ...rest];
	return {
		command: args.execPath,
		args: fullArgs,
		cwd: args.cwd,
	};
}

/**
 * Spawn the detached child. Returns the `ChildProcess` so callers
 * can `.unref()` it (the helper already does so the parent's event
 * loop doesn't keep waiting) or log its PID.
 *
 * The child inherits stdio so its boot logs land on the same
 * terminal as the operator's `npm run dev`. In CI / piped scenarios
 * the operator should set `WORKBENCH_DISABLE_SELF_RESPAWN=1`.
 */
export function executeRespawn(deps: {
	readonly spawnFn?: typeof spawn;
	readonly execPath: string;
	readonly execArgv: readonly string[];
	readonly argv: readonly string[];
	readonly cwd: string;
}): ChildProcess {
	const { command, args, cwd } = buildRespawnArgs({
		execPath: deps.execPath,
		execArgv: deps.execArgv,
		argv: deps.argv,
		cwd: deps.cwd,
	});
	const spawnImpl = deps.spawnFn ?? spawn;
	const child = spawnImpl(command, args, {
		cwd,
		detached: true,
		stdio: "inherit",
		env: process.env,
	});
	child.unref();
	return child;
}
