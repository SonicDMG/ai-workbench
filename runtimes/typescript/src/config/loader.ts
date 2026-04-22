import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { interpolate } from "./interpolate.js";
import { type Config, ConfigSchema } from "./schema.js";

export async function loadConfig(path: string): Promise<Config> {
	const raw = await readFile(path, "utf8");
	const parsed: unknown = parseYaml(raw);
	const interpolated = interpolate(parsed, process.env, path);
	return ConfigSchema.parse(interpolated);
}

/**
 * Resolve the path to `workbench.yaml`, checking in order:
 *
 *   1. `--config <file>` CLI flag.
 *   2. `WORKBENCH_CONFIG` environment variable.
 *   3. `./workbench.yaml` in the current working directory.
 *   4. `./examples/workbench.yaml` — the sample config this runtime
 *      ships with. Lets `npm run dev` work out-of-the-box with no env
 *      vars or flags when run from the runtime directory.
 *   5. `/etc/workbench/workbench.yaml` — the Docker image default.
 *
 * The first candidate that exists (or is explicitly specified) wins.
 * If `--config` or `WORKBENCH_CONFIG` is set the value is returned
 * verbatim even if it doesn't exist — misconfiguration should fail
 * loudly rather than silently fall through to the next step.
 */
export function resolveConfigPath(
	argv: string[] = process.argv,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const flagIdx = argv.indexOf("--config");
	if (flagIdx >= 0) {
		const next = argv[flagIdx + 1];
		if (next) return next;
	}
	if (env.WORKBENCH_CONFIG) return env.WORKBENCH_CONFIG;
	if (existsSync("./workbench.yaml")) return "./workbench.yaml";
	if (existsSync("./examples/workbench.yaml")) {
		return "./examples/workbench.yaml";
	}
	return "/etc/workbench/workbench.yaml";
}
