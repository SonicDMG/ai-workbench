/**
 * Shared ingest pipeline — chunks the input, upserts through the
 * text-or-vector dispatch, then transitions the document row to
 * `ready` (or `failed` on error).
 *
 * Both the synchronous and asynchronous ingest routes call this. The
 * only difference between them is **when** they return: sync waits
 * for this to finish; async spawns it detached and returns the job
 * id first.
 *
 * The function calls `onProgress({ processed, total })` at most once
 * before the upsert and once after it finishes. Future chunk-level
 * progress (per-batch or per-chunk) wires through the same callback.
 */

import type { ControlPlaneStore } from "../control-plane/store.js";
import type {
	CatalogRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import { dispatchUpsert } from "../routes/api-v1/upsert-dispatch.js";
import type { ChunkerOptions } from "./chunker.js";
import {
	CATALOG_SCOPE_KEY,
	CHUNK_INDEX_KEY,
	DOCUMENT_SCOPE_KEY,
} from "./payload-keys.js";
import { RecursiveCharacterChunker } from "./recursive-chunker.js";

export interface IngestInput {
	readonly text: string;
	readonly metadata?: Readonly<Record<string, string>>;
	readonly chunker?: ChunkerOptions;
}

export interface IngestPipelineDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
}

export interface IngestContext {
	readonly workspace: WorkspaceRecord;
	readonly catalog: CatalogRecord;
	readonly descriptor: VectorStoreRecord;
	readonly documentUid: string;
}

export interface IngestProgress {
	readonly processed: number;
	readonly total: number;
}

export interface IngestResult {
	readonly chunks: number;
}

/**
 * Run the chunk → embed → upsert pipeline for a single document.
 *
 * Caller is responsible for creating the {@link DocumentRecord} up
 * front (so both sync and async callers can return it before the
 * pipeline completes). On success this function flips the document
 * row to `ready`; on failure, to `failed` with `errorMessage`, then
 * re-raises.
 */
export async function runIngest(
	deps: IngestPipelineDeps,
	ctx: IngestContext,
	input: IngestInput,
	onProgress?: (p: IngestProgress) => void,
): Promise<IngestResult> {
	const { store, drivers, embedders } = deps;
	const { workspace, catalog, descriptor, documentUid } = ctx;

	const chunker = new RecursiveCharacterChunker(input.chunker);
	const chunks = chunker.chunk({
		text: input.text,
		metadata: input.metadata,
	});

	// Anchor the chunk count on the document row up front so pollers
	// see a meaningful total even before upsert finishes.
	await store.updateDocument(workspace.uid, catalog.uid, documentUid, {
		chunkTotal: chunks.length,
	});
	onProgress?.({ processed: 0, total: chunks.length });

	const driver = drivers.for(workspace);

	try {
		if (chunks.length > 0) {
			await dispatchUpsert({
				ctx: { workspace, descriptor },
				driver,
				embedders,
				records: chunks.map((chunk) => ({
					id: `${documentUid}:${chunk.index}`,
					text: chunk.text,
					payload: {
						...chunk.metadata,
						[CATALOG_SCOPE_KEY]: catalog.uid,
						[DOCUMENT_SCOPE_KEY]: documentUid,
						[CHUNK_INDEX_KEY]: chunk.index,
					},
				})),
			});
		}
		onProgress?.({ processed: chunks.length, total: chunks.length });
		await store.updateDocument(workspace.uid, catalog.uid, documentUid, {
			status: "ready",
			ingestedAt: new Date().toISOString(),
		});
		return { chunks: chunks.length };
	} catch (err) {
		await store
			.updateDocument(workspace.uid, catalog.uid, documentUid, {
				status: "failed",
				errorMessage: err instanceof Error ? err.message : String(err),
			})
			.catch(() => undefined);
		throw err;
	}
}
