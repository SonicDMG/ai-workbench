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
			// Ratcheted up from 70/65 to lock in current floor — see
			// `CONTRIBUTING.md`. Target is 80/80 across the board; raise
			// these only after adding tests, never lower them.
			thresholds: {
				lines: 76,
				statements: 75,
				branches: 67,
				functions: 80,
			},
		},
	},
});
