import type { WorkspaceRecord } from "../../../control-plane/types.js";

/** Map the internal `uid` field to the public `workspaceId` naming. */
export function toWireWorkspace(record: WorkspaceRecord) {
	const { uid, ...rest } = record;
	return { workspaceId: uid, ...rest };
}
