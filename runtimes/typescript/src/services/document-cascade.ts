/**
 * Document deletion with vector-store chunk cascade.
 *
 * Lifted out of the kb-documents route so the ingest service can
 * reuse it on the overwrite-on-name-conflict path: when a user opts
 * to overwrite an existing document with new content of the same
 * filename, we drop the old document's row + its vector chunks
 * before re-running the ingest pipeline. The route's hard-delete
 * endpoint (`DELETE /knowledge-bases/:kb/documents/:doc`) calls this
 * too, so the cascade behavior stays in one place.
 *
 * Drivers that support batch `deleteRecords` get a single round trip;
 * older drivers fall back to a list-then-delete loop. Drivers without
 * either capability quietly skip the chunk cleanup — orphan chunks
 * surface in KB-scoped search but the document row itself is gone,
 * which matches the legacy behavior the route used to have.
 */

import type { ControlPlaneStore } from "../control-plane/store.js";
import type {
	KnowledgeBaseRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import { DOCUMENT_SCOPE_KEY, KB_SCOPE_KEY } from "../ingest/payload-keys.js";

export interface DocumentCascadeArgs {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly workspace: WorkspaceRecord;
	readonly knowledgeBase: KnowledgeBaseRecord;
	readonly descriptor: VectorStoreRecord;
	readonly documentId: string;
}

/**
 * Drop a document's chunks from the workspace's vector collection.
 * Returns the number of chunk records removed; `null` when the
 * driver implements neither `deleteRecords` nor `listRecords` (no
 * cleanup performed). Callers should still proceed with the doc-row
 * delete — leftover chunks in pathological backends are tolerated
 * the same way the route's hard-delete tolerated them.
 */
async function dropDocumentChunks(
	args: DocumentCascadeArgs,
): Promise<number | null> {
	const { drivers, workspace, knowledgeBase, descriptor, documentId } = args;
	const driver = drivers.for(workspace);
	const filter = {
		[KB_SCOPE_KEY]: knowledgeBase.knowledgeBaseId,
		[DOCUMENT_SCOPE_KEY]: documentId,
	};
	if (typeof driver.deleteRecords === "function") {
		const result = await driver.deleteRecords(
			{ workspace, descriptor },
			filter,
		);
		return typeof result?.deleted === "number" ? result.deleted : 0;
	}
	if (typeof driver.listRecords === "function") {
		const rows = await driver.listRecords(
			{ workspace, descriptor },
			{ filter, limit: 1000 },
		);
		for (const r of rows) {
			await driver.deleteRecord({ workspace, descriptor }, r.id);
		}
		return rows.length;
	}
	return null;
}

/**
 * Delete a document's chunks (vector store) AND its row (control
 * plane) in that order. Mirrors the cascade the route's hard-delete
 * has always run; surfaces a `deleted` flag so callers can decide
 * whether to throw a 404 (route) or treat the missing row as a
 * benign race (overwrite path racing with another tab's delete).
 */
export async function cascadeDeleteRagDocument(
	args: DocumentCascadeArgs,
): Promise<{
	readonly deleted: boolean;
	readonly chunksDropped: number | null;
}> {
	const { store, workspace, knowledgeBase, documentId } = args;
	const chunksDropped = await dropDocumentChunks(args);
	const { deleted } = await store.deleteRagDocument(
		workspace.uid,
		knowledgeBase.knowledgeBaseId,
		documentId,
	);
	return { deleted, chunksDropped };
}
