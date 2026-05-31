import type { WorkspaceRecord } from "../../control-plane/types.js";
import type { WorkspaceRow } from "../row-types.js";
import { asPlainStringMap, asUuidString } from "./coerce.js";

export function workspaceToRow(r: WorkspaceRecord): WorkspaceRow {
	return {
		uid: r.uid,
		name: r.name,
		url: r.url,
		kind: r.kind,
		keyspace: r.keyspace,
		credentials: { ...r.credentials },
		rlac_enabled: r.rlacEnabled,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function workspaceFromRow(row: WorkspaceRow): WorkspaceRecord {
	// Defensive `?? null` on url/keyspace so rows written before those
	// columns existed (or rows where the Astra driver decodes a missing
	// column as undefined rather than null) come back through this
	// converter as the typed `string | null` shape — matches the
	// memory/file stores and keeps the WorkspaceRecord wire format
	// honest. Without this, a missing field reaches the JSON
	// serializer as `undefined` and gets stripped, which fails the
	// UI's schema validation downstream.
	//
	// `asUuidString` + `asPlainStringMap` coerce the runtime-class
	// shapes (UUID + Map) the Tables serdes hands us back, see the
	// "Coercion helpers" header in `coerce.ts` for the full rationale.
	return {
		uid: asUuidString(row.uid),
		name: row.name,
		url: row.url ?? null,
		kind: row.kind,
		keyspace: row.keyspace ?? null,
		credentials: asPlainStringMap(row.credentials),
		// Legacy rows (written before the column existed) decode as
		// `false` — the safest default for a feature gate.
		rlacEnabled: row.rlac_enabled ?? false,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
