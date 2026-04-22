/**
 * Resolves `file:<absolute-path>` → contents of the file, trimmed of
 * trailing whitespace/newlines.
 *
 * Trimming matters for tokens like `AstraCS:...` where a trailing
 * newline from a text editor would break authentication. Use
 * `file:/etc/workbench/secrets/astra-token` with the token on one
 * line.
 */

import { readFile } from "node:fs/promises";
import type { SecretProvider } from "./provider.js";

export class FileSecretProvider implements SecretProvider {
	async resolve(path: string): Promise<string> {
		const raw = await readFile(path, "utf8");
		return raw.trimEnd();
	}
}
