/**
 * Tests for the self-respawn helper. The runtime's `/setup/restart`
 * relies on this in dev — without it, SIGTERM kills the process and
 * the SPA's `/readyz` poll spins forever.
 *
 * The actual `spawn` syscall is mocked: forking a real child inside
 * the test runner would inherit vitest's parent stdio and orphan the
 * worker.
 */

import type { ChildProcess } from "node:child_process";
import { describe, expect, test, vi } from "vitest";
import {
	buildRespawnArgs,
	executeRespawn,
	planRespawn,
} from "../../src/lib/respawn.js";

describe("planRespawn", () => {
	test("PID 1 → container mode (orchestrator handles restart)", () => {
		const plan = planRespawn({ pid: 1, containerEnv: {} });
		expect(plan.mode).toBe("container");
		expect(plan.reason).toMatch(/PID 1/);
	});

	test("WORKBENCH_DISABLE_SELF_RESPAWN=1 → container mode (external supervisor)", () => {
		const plan = planRespawn({
			pid: 12345,
			containerEnv: { WORKBENCH_DISABLE_SELF_RESPAWN: "1" },
		});
		expect(plan.mode).toBe("container");
		expect(plan.reason).toMatch(/WORKBENCH_DISABLE_SELF_RESPAWN/);
	});

	test("non-PID-1 + no override → spawn mode (dev)", () => {
		const plan = planRespawn({ pid: 12345, containerEnv: {} });
		expect(plan.mode).toBe("spawn");
		expect(plan.reason).toMatch(/no orchestrator/i);
	});

	test("WORKBENCH_DISABLE_SELF_RESPAWN values other than '1' don't disable", () => {
		const plan = planRespawn({
			pid: 12345,
			containerEnv: { WORKBENCH_DISABLE_SELF_RESPAWN: "0" },
		});
		expect(plan.mode).toBe("spawn");
	});
});

describe("buildRespawnArgs", () => {
	test("drops the leading `node` from argv and re-prepends execArgv", () => {
		const plan = buildRespawnArgs({
			execPath: "/usr/bin/node",
			execArgv: ["--enable-source-maps"],
			argv: ["/usr/bin/node", "dist/root.js", "--flag"],
			cwd: "/srv/app",
		});
		expect(plan.command).toBe("/usr/bin/node");
		expect(plan.args).toEqual([
			"--enable-source-maps",
			"dist/root.js",
			"--flag",
		]);
		expect(plan.cwd).toBe("/srv/app");
	});

	test("preserves --import / --require style execArgv (used by tsx / OTel preload)", () => {
		const plan = buildRespawnArgs({
			execPath: "/usr/bin/node",
			execArgv: ["--import", "tsx/dist/loader.mjs"],
			argv: ["/usr/bin/node", "src/root.ts"],
			cwd: "/work",
		});
		expect(plan.args).toEqual([
			"--import",
			"tsx/dist/loader.mjs",
			"src/root.ts",
		]);
	});

	test("works with no execArgv and no user argv beyond the script", () => {
		const plan = buildRespawnArgs({
			execPath: "/usr/bin/node",
			execArgv: [],
			argv: ["/usr/bin/node", "root.js"],
			cwd: ".",
		});
		expect(plan.args).toEqual(["root.js"]);
	});
});

describe("executeRespawn", () => {
	test("calls spawn with command, computed args, detached:true, stdio:'inherit', and unrefs the child", () => {
		const fakeChild = { unref: vi.fn(), pid: 99999 } as unknown as ChildProcess;
		const spawnFn = vi.fn().mockReturnValue(fakeChild);
		const child = executeRespawn({
			spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
			execPath: "/usr/bin/node",
			execArgv: [],
			argv: ["/usr/bin/node", "dist/root.js"],
			cwd: "/srv/app",
		});
		expect(spawnFn).toHaveBeenCalledOnce();
		const call = spawnFn.mock.calls[0];
		if (!call) throw new Error("expected spawn call to be recorded");
		const [cmd, args, opts] = call;
		expect(cmd).toBe("/usr/bin/node");
		expect(args).toEqual(["dist/root.js"]);
		expect(opts).toMatchObject({
			cwd: "/srv/app",
			detached: true,
			stdio: "inherit",
		});
		expect(fakeChild.unref).toHaveBeenCalledOnce();
		expect(child).toBe(fakeChild);
	});
});
