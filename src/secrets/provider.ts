/**
 * Secret resolution contract.
 *
 * Secrets never appear by value in config or records — only as
 * {@link SecretRef} pointers of the form `"<provider>:<path>"`. A
 * {@link SecretResolver} looks up the matching provider and returns
 * the raw value on demand.
 *
 * Currently ships with `env` and `file` providers; `vault` and similar
 * backends plug in against the same {@link SecretProvider} interface.
 */

import type { SecretRef } from "../control-plane/types.js";

/** Strategy for a single provider prefix (e.g. `env`, `file`, `vault`). */
export interface SecretProvider {
	/**
	 * Resolve the provider-specific path portion of a ref
	 * (everything after the first `:`).
	 *
	 * Throws if the path cannot be resolved. The caller is responsible
	 * for wrapping the error with user-facing context.
	 */
	resolve(path: string): Promise<string>;
}

export class UnknownSecretProviderError extends Error {
	constructor(public readonly prefix: string) {
		super(`unknown secret provider '${prefix}'`);
		this.name = "UnknownSecretProviderError";
	}
}

export class InvalidSecretRefError extends Error {
	constructor(public readonly ref: string) {
		super(`invalid secret ref '${ref}' — expected '<provider>:<path>'`);
		this.name = "InvalidSecretRefError";
	}
}

/**
 * Dispatches refs to the right {@link SecretProvider} based on the
 * prefix. Constructed once at startup from the resolved secrets config.
 */
export class SecretResolver {
	constructor(
		private readonly providers: Readonly<Record<string, SecretProvider>>,
	) {}

	async resolve(ref: SecretRef): Promise<string> {
		const colon = ref.indexOf(":");
		if (colon < 1) throw new InvalidSecretRefError(ref);
		const prefix = ref.slice(0, colon);
		const path = ref.slice(colon + 1);
		const provider = this.providers[prefix];
		if (!provider) throw new UnknownSecretProviderError(prefix);
		return provider.resolve(path);
	}

	has(prefix: string): boolean {
		return prefix in this.providers;
	}
}
