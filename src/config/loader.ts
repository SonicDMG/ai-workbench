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
	return "/etc/workbench/workbench.yaml";
}
