/**
 * API-key aggregate slice. Owns the `api-keys.json` table. Every
 * mutation acquires the api-keys mutex before touching disk;
 * workspace existence is asserted ahead of the mutex acquisition so
 * the surface matches the in-memory store.
 */

import { byCreatedAtThenKeyId, nowIso } from "../defaults.js";
import { ControlPlaneConflictError } from "../errors.js";
import type { ApiKeyRepo, PersistApiKeyInput } from "../store.js";
import { type ApiKeyRecord, normalizeApiKeyScopes } from "../types.js";
import { assertWorkspace, type FileStoreState } from "./state.js";

/**
 * Patch a row read from disk with the back-compat `scopes` default
 * when older snapshots predate the column. Cheap to run on every
 * read — `normalizeApiKeyScopes` is allocation-free on the
 * already-set case (returns the same array reference would require
 * more work; the default-only path constructs once).
 */
function withScopesDefault(row: ApiKeyRecord): ApiKeyRecord {
	if (Array.isArray(row.scopes) && row.scopes.length > 0) return row;
	return { ...row, scopes: normalizeApiKeyScopes(row.scopes) };
}

export function makeApiKeyMethods(state: FileStoreState): ApiKeyRepo {
	return {
		async listApiKeys(workspace: string): Promise<readonly ApiKeyRecord[]> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("api-keys");
			return all
				.filter((k) => k.workspace === workspace)
				.map(withScopesDefault)
				.sort(byCreatedAtThenKeyId);
		},

		async getApiKey(
			workspace: string,
			keyId: string,
		): Promise<ApiKeyRecord | null> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("api-keys");
			const found = all.find(
				(k) => k.workspace === workspace && k.keyId === keyId,
			);
			return found ? withScopesDefault(found) : null;
		},

		async persistApiKey(
			workspace: string,
			input: PersistApiKeyInput,
		): Promise<ApiKeyRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("api-keys", (rows) => {
				if (rows.some((k) => k.prefix === input.prefix)) {
					throw new ControlPlaneConflictError(
						`api key with prefix '${input.prefix}' already exists`,
					);
				}
				if (
					rows.some((k) => k.workspace === workspace && k.keyId === input.keyId)
				) {
					throw new ControlPlaneConflictError(
						`api key with id '${input.keyId}' already exists in workspace '${workspace}'`,
					);
				}
				const record: ApiKeyRecord = {
					workspace,
					keyId: input.keyId,
					prefix: input.prefix,
					hash: input.hash,
					label: input.label,
					scopes: normalizeApiKeyScopes(input.scopes),
					createdAt: nowIso(),
					lastUsedAt: null,
					revokedAt: null,
					expiresAt: input.expiresAt ?? null,
				};
				return { rows: [...rows, record], result: record };
			});
		},

		async revokeApiKey(
			workspace: string,
			keyId: string,
		): Promise<{ revoked: boolean }> {
			await assertWorkspace(state, workspace);
			return state.mutate<"api-keys", { revoked: boolean }>(
				"api-keys",
				(rows) => {
					const idx = rows.findIndex(
						(k) => k.workspace === workspace && k.keyId === keyId,
					);
					if (idx < 0) return { rows, result: { revoked: false } };
					const existing = rows[idx] as ApiKeyRecord;
					if (existing.revokedAt !== null) {
						return { rows, result: { revoked: false } };
					}
					const next = [...rows];
					next[idx] = { ...existing, revokedAt: nowIso() };
					return { rows: next, result: { revoked: true } };
				},
			);
		},

		async findApiKeyByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
			const all = await state.readAll("api-keys");
			const found = all.find((k) => k.prefix === prefix);
			return found ? withScopesDefault(found) : null;
		},

		async touchApiKey(workspace: string, keyId: string): Promise<void> {
			await state.mutate("api-keys", (rows) => {
				const idx = rows.findIndex(
					(k) => k.workspace === workspace && k.keyId === keyId,
				);
				if (idx < 0) return { rows, result: null };
				const next = [...rows];
				next[idx] = { ...(rows[idx] as ApiKeyRecord), lastUsedAt: nowIso() };
				return { rows: next, result: null };
			});
		},
	};
}
