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
				//  - `forms` is only pulled in on detail / onboarding routes.
				//    With lazy routes it still splits automatically, but
				//    naming it stabilizes the URL across builds.
				//  - `radix` is a cluster of primitives; grouping them avoids
				//    dozens of tiny async chunks.
				manualChunks: {
					react: ["react", "react-dom", "react-router-dom"],
					query: ["@tanstack/react-query"],
					forms: ["react-hook-form", "@hookform/resolvers", "zod"],
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
