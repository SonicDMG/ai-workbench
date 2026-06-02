/**
 * Release version of the web UI. Bumped in lockstep with
 * `apps/web/package.json` so the header chip and any future
 * "what's-new" gating can rely on a single source of truth.
 *
 * Kept as a hand-edited constant rather than `import.meta.env`-driven
 * so the value is stable across build environments (CI, local dev,
 * Docker) and visible at code-review time.
 */
export const APP_VERSION = "0.5.1";
