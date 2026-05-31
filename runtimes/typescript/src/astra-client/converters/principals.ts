import { type PrincipalRecord, parseRole } from "../../control-plane/types.js";
import type { PrincipalRow } from "../row-types.js";
import { asIsoString, asPlainStringMap, asUuidString } from "./coerce.js";

export function principalToRow(r: PrincipalRecord): PrincipalRow {
	return {
		workspace_id: r.workspaceId,
		principal_id: r.principalId,
		label: r.label,
		attributes: { ...r.attributes },
		role: r.role,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function principalFromRow(row: PrincipalRow): PrincipalRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		principalId: row.principal_id,
		label: row.label,
		attributes: asPlainStringMap(row.attributes),
		role: parseRole(row.role),
		// `timestamp` columns come back as `Date` from astra-db-ts;
		// coerce to ISO-8601 so consumers can sort/compare with
		// `localeCompare` and `<` without crashing.
		createdAt: asIsoString(row.created_at),
		updatedAt: asIsoString(row.updated_at),
	};
}
