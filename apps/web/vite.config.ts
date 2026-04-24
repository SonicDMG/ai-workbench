import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Proxy /api/* to the TS runtime in dev so the UI is same-origin.
// Override the target via VITE_API_TARGET when the runtime is not on :8080.
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: process.env.VITE_API_TARGET ?? "http://localhost:8080",
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: "dist",
		sourcemap: true,
		rollupOptions: {
			output: {
				// Deliberate manual chunking:
				//  - `react` gets its own chunk so router + query both pin to
				//    the same copy (Vite hoists duplicates otherwise).
				//  - `query` is heavy (~40kB gz) but used on every page.
				//  - `zod` is on the eager path because lib/api.ts validates
				//    every response through a schema — naming it makes that
				//    eagerness explicit. Grouping it into `forms` was a bug:
				//    Vite correctly preloads every chunk an eager import
				//    reaches, so bundling `zod` with the lazy form libs
				//    pulled the whole `forms` chunk into first paint.
				//  - `forms` now only holds `react-hook-form` + resolvers,
				//    which ARE only referenced from the lazy routes, so the
				//    chunk stays out of the initial preload graph.
				//  - `radix` is a cluster of primitives; grouping them avoids
				//    dozens of tiny async chunks.
				manualChunks: {
					react: ["react", "react-dom", "react-router-dom"],
					query: ["@tanstack/react-query"],
					zod: ["zod"],
					forms: ["react-hook-form", "@hookform/resolvers"],
					radix: [
						"@radix-ui/react-dialog",
						"@radix-ui/react-label",
						"@radix-ui/react-select",
						"@radix-ui/react-slot",
					],
				},
			},
		},
	},
});
