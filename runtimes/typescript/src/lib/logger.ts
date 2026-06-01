import { pino } from "pino";

// The logger is initialized before config loads (other modules import it
// at top level), so its level starts at env-or-info. `applyLogLevel` is
// the second step, called from root.ts once `workbench.yaml` is parsed.
const envLevelRaw = process.env.LOG_LEVEL;
const envLevel =
	envLevelRaw !== undefined && envLevelRaw.length > 0 ? envLevelRaw : undefined;
const initialLevel = envLevel ?? "info";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Defense-in-depth redaction allowlist. A stray
 * `logger.info({ headers })` or `logger.error({ err, config })` must
 * never leak a credential, so every path that could plausibly carry one
 * is scrubbed to `[Redacted]` before serialization.
 *
 * The list pairs a small set of common header locations (Authorization
 * lives under different parents depending on whether a raw request, a
 * Fetch init, or a Headers-like object got logged) with the field names
 * the runtime uses for secrets (`tokenRef`, `credentialRef`, `apiKey`,
 * `password`, …). Wildcards (`*.field`) catch the field one level deep
 * regardless of parent key, which covers the typical
 * `logger.x({ something: { token } })` shape without enumerating every
 * parent. Matching is case-sensitive, so each casing variant we actually
 * emit (`authorization` lowercase on Fetch headers, `Authorization`
 * capitalized on raw Node requests) is listed explicitly.
 */
const REDACT_PATHS = [
	// Authorization headers, across the parents we actually log.
	"authorization",
	"Authorization",
	"headers.authorization",
	"headers.Authorization",
	"req.headers.authorization",
	"req.headers.Authorization",
	"request.headers.authorization",
	"request.headers.Authorization",
	"*.authorization",
	"*.Authorization",
	// Secret-bearing fields, at top level and one level deep under any
	// parent. Covers token / secret / credential / password / apiKey
	// and the runtime's `*Ref` indirection names.
	"token",
	"tokenRef",
	"secret",
	"credential",
	"credentialRef",
	"credentials",
	"password",
	"apiKey",
	"*.token",
	"*.tokenRef",
	"*.secret",
	"*.credential",
	"*.credentialRef",
	"*.credentials",
	"*.password",
	"*.apiKey",
];

export const logger = pino({
	level: initialLevel,
	redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
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
