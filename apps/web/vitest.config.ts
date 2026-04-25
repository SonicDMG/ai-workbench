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
	},
});
