import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		globals: false,
		environment: "node",
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "json-summary"],
			include: ["src/**/*.ts"],
			exclude: ["src/version.ts"],
			thresholds: {
				lines: 70,
				statements: 70,
				branches: 65,
				functions: 70,
			},
		},
	},
});
