import { pino } from "pino";

// The logger is initialized before config loads (other modules import it
// at top level), so its level starts at env-or-info. `applyLogLevel` is
// the second step, called from root.ts once `workbench.yaml` is parsed.
const envLevelRaw = process.env.LOG_LEVEL;
const envLevel =
	envLevelRaw !== undefined && envLevelRaw.length > 0 ? envLevelRaw : undefined;
const initialLevel = envLevel ?? "info";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
	level: initialLevel,
	...(isDev
		? {
				transport: {
					target: "pino-pretty",
					options: { colorize: true, translateTime: "SYS:standard" },
				},
			}
		: {}),
});

export type Logger = typeof logger;

/**
 * Apply `runtime.logLevel` from config. `LOG_LEVEL` env wins when set
 * so ops can override without editing yaml.
 *
 * Returns the level that ended up in effect (and why) for startup
 * logging.
 */
export function applyLogLevel(configured: string): {
	level: string;
	source: "env" | "config";
} {
	if (envLevel !== undefined) {
		return { level: envLevel, source: "env" };
	}
	logger.level = configured;
	return { level: configured, source: "config" };
}
