import { defineConfig, devices } from "@playwright/test";

// Playwright runs the production-shape stack:
//
//   1. apps/web is built into apps/web/dist (vite).
//   2. The TypeScript runtime is built into runtimes/typescript/dist.
//   3. The runtime is started; it auto-discovers the SPA at
//      ../../apps/web/dist (see runtimes/typescript/src/ui/assets.ts)
//      and serves it on the same origin as the API.
//
// `webServer` chains the two builds and the start command so a fresh
// `npm run test:e2e` from apps/web is enough — no global pre-step
// required. CI does the same; the Docker job already proves the
// build pieces work end-to-end.

const PORT = 8080;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = "../../";

export default defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		// One shell so the runtime sees the freshly built SPA and JS.
		// Reusing an existing :8080 server in dev makes iteration fast.
		command: [
			"npm --prefix runtimes/typescript run build",
			"npm --prefix apps/web run build",
			"node runtimes/typescript/dist/root.js",
		].join(" && "),
		cwd: REPO_ROOT,
		url: `${BASE_URL}/healthz`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			NODE_ENV: "production",
			// The bundled example yaml is `memory` + `auth.mode:
			// disabled` — exactly what we want for a hermetic E2E run.
			// Without this the loader walks the cwd, doesn't find a
			// workbench.yaml at the repo root, and falls through to
			// /etc/workbench/workbench.yaml which doesn't exist on dev
			// laptops or CI runners.
			WORKBENCH_CONFIG: "runtimes/typescript/examples/workbench.yaml",
		},
	},
});
