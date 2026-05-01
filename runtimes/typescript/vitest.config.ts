import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		globals: false,
		environment: "node",
		// Quiet pino's per-request access log + audit info lines during
		// tests. The logger reads `LOG_LEVEL` at module-load time, so
		// it has to be set before any test imports the app module.
		env: {
			LOG_LEVEL: "warn",
		},
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
