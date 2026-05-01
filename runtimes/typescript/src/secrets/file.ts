/**
 * Resolves `file:<absolute-path>` → contents of the file, trimmed of
 * trailing whitespace/newlines.
 *
 * Trimming matters for tokens like `AstraCS:...` where a trailing
 * newline from a text editor would break authentication. Use
 * `file:/etc/workbench/secrets/astra-token` with the token on one
 * line.
 *
 * Path sandboxing: an operator misconfiguring `file:../../../etc/passwd`
 * or `file:/proc/self/environ` would otherwise silently resolve those
 * contents as a secret value. The provider rejects relative paths,
 * `..` segments, and known sensitive system roots before touching the
 * filesystem. This is a defense-in-depth check on top of operator
 * trust — the operator owns `workbench.yaml` — but it eliminates the
 * accidental-misconfig footgun.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, sep } from "node:path";
import type { SecretProvider } from "./provider.js";

const BLOCKED_PATH_PREFIXES = [
	`${sep}proc${sep}`,
	`${sep}sys${sep}`,
	`${sep}dev${sep}`,
];
const BLOCKED_PATH_EXACT = new Set([`${sep}proc`, `${sep}sys`, `${sep}dev`]);

export class FileSecretRefError extends Error {
	constructor(
		reason: string,
		public readonly path: string,
	) {
		super(`file secret ref rejected: ${reason}`);
		this.name = "FileSecretRefError";
	}
}

export class FileSecretProvider implements SecretProvider {
	async resolve(path: string): Promise<string> {
		assertSafeSecretPath(path);
		const raw = await readFile(path, "utf8");
		return raw.trimEnd();
	}
}

/**
 * Reject misconfigured `file:` refs before they hit the filesystem.
 * Exported for direct unit testing — the public surface is
 * {@link FileSecretProvider.resolve}.
 */
export function assertSafeSecretPath(path: string): void {
	if (path.length === 0) {
		throw new FileSecretRefError("empty path", path);
	}
	if (!isAbsolute(path)) {
		throw new FileSecretRefError(
			"path must be absolute (e.g. file:/etc/workbench/secrets/token)",
			path,
		);
	}
	const normalized = normalize(path);
	// `normalize` on POSIX collapses `a/b/../c` → `a/c`, but
	// `/../etc/passwd` collapses to `/etc/passwd`, which would silently
	// pass. Reject any `..` in the original input as the safer rule;
	// secret refs should be plain absolute paths.
	if (path.split(sep).some((segment) => segment === "..")) {
		throw new FileSecretRefError("path may not contain '..' segments", path);
	}
	if (BLOCKED_PATH_EXACT.has(normalized)) {
		throw new FileSecretRefError(
			"path may not point at a system pseudo-filesystem root",
			path,
		);
	}
	for (const prefix of BLOCKED_PATH_PREFIXES) {
		if (normalized.startsWith(prefix)) {
			throw new FileSecretRefError(
				"path may not point inside /proc, /sys, or /dev",
				path,
			);
		}
	}
}
