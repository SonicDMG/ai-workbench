import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Proxy the runtime's URL prefixes to :8080 in dev so the UI is
// effectively same-origin. In the shipped Docker image the runtime
// serves the UI and the API on the same host, so there's no proxy
// there — this config is dev-only. Override the target via
// VITE_API_TARGET when the runtime is not on :8080.
//
// Prefixes:
//   /api   — control-plane + data-plane JSON routes (since day 1)
//   /auth  — OIDC browser-login endpoints (since #34). The UI probes
//            /auth/config + /auth/me on mount to decide whether to
//            show the login button; without this entry, dev logs a
//            404 for each on every page load.
//   /docs  — Scalar reference UI served by the runtime. Convenient
//            for clicking the API-docs link in dev.
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
			"/auth": {
				target: process.env.VITE_API_TARGET ?? "http://localhost:8080",
				changeOrigin: true,
			},
			"/docs": {
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
