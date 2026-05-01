import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest config for apps/web. Kept separate from vite.config.ts so we
// don't pull the production manualChunks splitting (or the dev proxy
// targets) into the test environment. The `@/*` alias is reproduced
// from vite.config.ts and tsconfig.app.json so test imports match
// runtime imports.
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		environment: "jsdom",
		globals: false,
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		css: false,
		clearMocks: true,
		restoreMocks: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "json-summary"],
			// Coverage gates ratchet upward only — never lower a number
			// without a comment explaining why. The `api.ts` client is
			// excluded from gates until it has its own focused contract
			// tests; pages are exercised through Playwright today and
			// will be gated once we have unit-level tests for them.
			thresholds: {
				"src/lib/{authToken,files,schemas,utils,session}.ts": {
					lines: 50,
					statements: 50,
					branches: 80,
					functions: 20,
				},
				// Workspace dashboard surface — the largest component
				// tree and the highest-traffic regression zone. Floors
				// ratcheted up after adding DocumentDetailDialog tests
				// (the prior 0%-coverage hole in this folder).
				"src/components/workspaces/**/*.{ts,tsx}": {
					lines: 72,
					statements: 69,
					branches: 62,
					functions: 60,
				},
			},
		},
	},
});
