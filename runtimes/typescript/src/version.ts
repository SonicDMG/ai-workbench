import packageJson from "../package.json" with { type: "json" };

function nonEmpty(value: string | undefined): string | undefined {
	return value && value.length > 0 ? value : undefined;
}

/**
 * Runtime version. Sourced from `APP_VERSION` (set by the Docker build /
 * release pipeline) when present; otherwise falls back to the
 * declarative `version` field in `runtimes/typescript/package.json` so
 * dev runs and unreleased builds report something more meaningful than
 * `"0.0.0"`.
 */
export const VERSION =
	nonEmpty(process.env.APP_VERSION) ?? (packageJson.version as string);
export const COMMIT = nonEmpty(process.env.APP_COMMIT) ?? "unknown";
export const BUILD_TIME =
	nonEmpty(process.env.APP_BUILD_TIME) ?? new Date().toISOString();
