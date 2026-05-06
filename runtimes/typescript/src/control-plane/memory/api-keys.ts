/**
 * API-key aggregate slice. Pure delegation to
 * {@link ./api-key-repository.MemoryApiKeyRepository} which already
 * owns the state and prefix index.
 */

import type { ApiKeyRepo, PersistApiKeyInput } from "../store.js";
import type { ApiKeyRecord } from "../types.js";
import type { MemoryStoreState } from "./state.js";

export function makeApiKeyMethods(state: MemoryStoreState): ApiKeyRepo {
	return {
		listApiKeys(workspace: string): Promise<readonly ApiKeyRecord[]> {
			return state.apiKeyRepo.list(workspace);
		},

		getApiKey(workspace: string, keyId: string): Promise<ApiKeyRecord | null> {
			return state.apiKeyRepo.get(workspace, keyId);
		},

		persistApiKey(
			workspace: string,
			input: PersistApiKeyInput,
		): Promise<ApiKeyRecord> {
			return state.apiKeyRepo.persist(workspace, input);
		},

		revokeApiKey(
			workspace: string,
			keyId: string,
		): Promise<{ revoked: boolean }> {
			return state.apiKeyRepo.revoke(workspace, keyId);
		},

		findApiKeyByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
			return state.apiKeyRepo.findByPrefix(prefix);
		},

		touchApiKey(workspace: string, keyId: string): Promise<void> {
			return state.apiKeyRepo.touch(workspace, keyId);
		},
	};
}
