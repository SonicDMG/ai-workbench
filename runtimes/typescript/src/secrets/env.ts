/**
 * Resolves `env:<VAR>` → `process.env.VAR`.
 *
 * Throws if the env var is unset or empty. This is the default
 * provider — fine for containers driven by `docker run -e`, K8s
 * Secrets mounted as env vars, and local `.env` files loaded before
 * the process starts.
 */

import type { SecretProvider } from "./provider.js";

export class EnvSecretProvider implements SecretProvider {
	async resolve(path: string): Promise<string> {
		const value = process.env[path];
		if (value === undefined || value === "") {
			throw new Error(`env var '${path}' is not set`);
		}
		return value;
	}
}
