import {
	type ApiKeyRecord,
	normalizeApiKeyScopes,
} from "../../control-plane/types.js";
import type { ApiKeyRow } from "../row-types.js";
import { asUuidString } from "./coerce.js";

export function apiKeyToRow(r: ApiKeyRecord): ApiKeyRow {
	return {
		workspace: r.workspace,
		key_id: r.keyId,
		prefix: r.prefix,
		hash: r.hash,
		label: r.label,
		// Cassandra `set<text>` accepts a plain array on insert.
		scopes: [...r.scopes],
		created_at: r.createdAt,
		last_used_at: r.lastUsedAt,
		revoked_at: r.revokedAt,
		expires_at: r.expiresAt,
	};
}

export function apiKeyFromRow(row: ApiKeyRow): ApiKeyRecord {
	return {
		workspace: asUuidString(row.workspace),
		keyId: asUuidString(row.key_id),
		prefix: row.prefix,
		hash: row.hash,
		label: row.label,
		// `set<text>` round-trips as a JS Set; older rows that predate
		// the column return null. The store-level normalizer downstream
		// would also default this, but we resolve it here so the
		// `ApiKeyRecord` shape is always concrete from the store
		// boundary down.
		scopes: normalizeApiKeyScopes(scopesFromColumn(row.scopes)),
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at,
		revokedAt: row.revoked_at,
		expiresAt: row.expires_at,
	};
}

/**
 * Coerce a Data-API `set<text>` value into a plain array. The SDK
 * returns a `Set<string>` when the column is present; older rows
 * (predating the additive `scopes` column) hand back `null` or
 * `undefined`.
 */
function scopesFromColumn(
	value: ApiKeyRow["scopes"],
): readonly string[] | null {
	if (value == null) return null;
	if (value instanceof Set) return [...value];
	return value as readonly string[];
}
