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
			// Coverage gates today only fire on the focused `src/lib`
			// helpers. The generated-ish API client is intentionally
			// excluded until it has its own focused contract tests.
			// Component coverage is exercised indirectly through
			// Playwright (#64); locking a number on it prematurely would
			// push us toward shallow tests.
			//
			// Numbers were calibrated against the suite at the time the
			// gate landed. Bump them as new tests land; never lower
			// without a comment explaining why.
			thresholds: {
				"src/lib/{authToken,files,schemas,utils,session}.ts": {
					lines: 50,
					statements: 50,
					branches: 80,
					functions: 20,
				},
			},
		},
	},
});
