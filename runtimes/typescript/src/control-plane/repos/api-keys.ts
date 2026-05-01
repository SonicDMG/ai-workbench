/**
 * API-key aggregate. Workspace-scoped except for the global
 * prefix-lookup the verifier uses on every authenticated request.
 */

import type { ApiKeyRecord } from "../types.js";

/**
 * Parameters needed to persist an {@link ApiKeyRecord}. The
 * caller is responsible for generating the keyId / prefix / hash
 * and handing the plaintext to the user exactly once.
 */
export interface PersistApiKeyInput {
	readonly keyId: string;
	readonly prefix: string;
	readonly hash: string;
	readonly label: string;
	readonly expiresAt?: string | null;
}

export interface ApiKeyRepo {
	listApiKeys(workspace: string): Promise<readonly ApiKeyRecord[]>;
	getApiKey(workspace: string, keyId: string): Promise<ApiKeyRecord | null>;
	persistApiKey(
		workspace: string,
		input: PersistApiKeyInput,
	): Promise<ApiKeyRecord>;
	revokeApiKey(workspace: string, keyId: string): Promise<{ revoked: boolean }>;
	/**
	 * Global lookup by wire prefix. Used by the API-key verifier on
	 * every authenticated request — must be O(1) / O(log N) on real
	 * backends. Memory and file walk; astra uses a dedicated lookup
	 * table partitioned by prefix.
	 */
	findApiKeyByPrefix(prefix: string): Promise<ApiKeyRecord | null>;
	/** Fire-and-forget bump of `lastUsedAt` after a successful verify. */
	touchApiKey(workspace: string, keyId: string): Promise<void>;
}
