#!/usr/bin/env node
// Ensures the compiled CLI entrypoint is executable on POSIX systems.
import { chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "..", "dist", "cli.js");

try {
	await chmod(cliPath, 0o755);
} catch (err) {
	if ((err && /** @type {NodeJS.ErrnoException} */ (err).code) === "ENOENT") {
		console.error(
			`[aiw-cli] expected ${cliPath} after build but it was not produced`,
		);
		process.exit(1);
	}
	throw err;
}
