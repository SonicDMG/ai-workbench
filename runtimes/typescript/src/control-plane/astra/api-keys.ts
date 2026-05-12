/**
 * API-key aggregate slice for the Astra-backed store. Owns the
 * `wb_api_keys` table plus the `wb_api_key_lookup` prefix index — the
 * primary row is inserted first so a crash before the lookup write
 * leaves an unreachable key (inconvenient but not unsafe; the
 * `findApiKeyByPrefix` verifier goes through the lookup).
 */

import { apiKeyFromRow, apiKeyToRow } from "../../astra-client/converters.js";
import { byCreatedAtThenKeyId, nowIso } from "../defaults.js";
import { ControlPlaneConflictError } from "../errors.js";
import type { ApiKeyRepo, PersistApiKeyInput } from "../store.js";
import { type ApiKeyRecord, normalizeApiKeyScopes } from "../types.js";
import { type AstraStoreState, assertWorkspace } from "./state.js";

export function makeApiKeyMethods(state: AstraStoreState): ApiKeyRepo {
	return {
		async listApiKeys(workspace: string): Promise<readonly ApiKeyRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.tables.apiKeys.find({ workspace }).toArray();
			return rows.map(apiKeyFromRow).sort(byCreatedAtThenKeyId);
		},

		async getApiKey(
			workspace: string,
			keyId: string,
		): Promise<ApiKeyRecord | null> {
			await assertWorkspace(state, workspace);
			const row = await state.tables.apiKeys.findOne({
				workspace,
				key_id: keyId,
			});
			return row ? apiKeyFromRow(row) : null;
		},

		async persistApiKey(
			workspace: string,
			input: PersistApiKeyInput,
		): Promise<ApiKeyRecord> {
			await assertWorkspace(state, workspace);
			if (await state.tables.apiKeyLookup.findOne({ prefix: input.prefix })) {
				throw new ControlPlaneConflictError(
					`api key with prefix '${input.prefix}' already exists`,
				);
			}
			if (
				await state.tables.apiKeys.findOne({ workspace, key_id: input.keyId })
			) {
				throw new ControlPlaneConflictError(
					`api key with id '${input.keyId}' already exists in workspace '${workspace}'`,
				);
			}
			const now = nowIso();
			const record: ApiKeyRecord = {
				workspace,
				keyId: input.keyId,
				prefix: input.prefix,
				hash: input.hash,
				label: input.label,
				scopes: normalizeApiKeyScopes(input.scopes),
				createdAt: now,
				lastUsedAt: null,
				revokedAt: null,
				expiresAt: input.expiresAt ?? null,
			};
			// Insert the row first, then the lookup entry. A crash after the
			// primary insert and before the lookup leaves an unreachable key
			// — inconvenient but not unsafe (the bad record can't be used to
			// auth since the verifier goes through the lookup).
			await state.tables.apiKeys.insertOne(apiKeyToRow(record));
			await state.tables.apiKeyLookup.insertOne({
				prefix: input.prefix,
				workspace,
				key_id: input.keyId,
			});
			return record;
		},

		async revokeApiKey(
			workspace: string,
			keyId: string,
		): Promise<{ revoked: boolean }> {
			await assertWorkspace(state, workspace);
			const row = await state.tables.apiKeys.findOne({
				workspace,
				key_id: keyId,
			});
			if (!row) return { revoked: false };
			if (row.revoked_at !== null) return { revoked: false };
			await state.tables.apiKeys.updateOne(
				{ workspace, key_id: keyId },
				{ $set: { revoked_at: nowIso() } },
			);
			return { revoked: true };
		},

		async findApiKeyByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
			const lookup = await state.tables.apiKeyLookup.findOne({ prefix });
			if (!lookup) return null;
			const row = await state.tables.apiKeys.findOne({
				workspace: lookup.workspace,
				key_id: lookup.key_id,
			});
			return row ? apiKeyFromRow(row) : null;
		},

		async touchApiKey(workspace: string, keyId: string): Promise<void> {
			await state.tables.apiKeys.updateOne(
				{ workspace, key_id: keyId },
				{ $set: { last_used_at: nowIso() } },
			);
		},
	};
}
