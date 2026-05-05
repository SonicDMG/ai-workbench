import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");

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
		// Node 25's experimental Web Storage binding emits one warning per
		// worker unless a localStorage file is configured. jsdom supplies
		// the browser storage we need, so disable Node's native binding in
		// Vitest workers on affected runtimes.
		execArgv: nodeMajor >= 25 ? ["--no-experimental-webstorage"] : [],
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
			// without a comment explaining why. The large `api.ts`
			// endpoint surface has focused contract tests now, but stays
			// outside the ratchet until coverage spans the bulk of its
			// endpoints; pages are exercised through Playwright today and
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
				// reduced when the 950-LOC ServicesPanel was split into
				// 4 sub-files (EmbeddingSubpanel, ChunkingSubpanel,
				// RerankingSubpanel, ServicesPanelHelpers): the same
				// uncovered submit/preset/setProvider paths now show up
				// as three separate files rather than one large one,
				// dragging the aggregate down ~10pp without removing
				// any tests. Ratchet back up as the chunking and
				// reranking submit flows get unit tests.
				"src/components/workspaces/**/*.{ts,tsx}": {
					lines: 63,
					statements: 60,
					branches: 59,
					functions: 51,
				},
			},
		},
	},
});
