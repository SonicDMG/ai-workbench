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
	ChunkingServiceRecord,
	KnowledgeBaseRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import { safeErrorMessage } from "../lib/safe-error.js";
import { dispatchUpsert } from "../routes/api-v1/upsert-dispatch.js";
import type { Chunker, ChunkerOptions } from "./chunker.js";
import { LineChunker } from "./line-chunker.js";
import {
	CHUNK_INDEX_KEY,
	CHUNK_TEXT_KEY,
	DOCUMENT_SCOPE_KEY,
	KB_SCOPE_KEY,
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

export interface IngestProgress {
	readonly processed: number;
	readonly total: number;
}

export interface IngestResult {
	readonly chunks: number;
}

/* ------------------------------------------------------------------ */
/* KB-scoped ingest (issue #98)                                       */
/* ------------------------------------------------------------------ */

export interface KbIngestContext {
	readonly workspace: WorkspaceRecord;
	readonly knowledgeBase: KnowledgeBaseRecord;
	/** Synthesised driver descriptor — the data plane stays
	 * descriptor-shaped while the control plane speaks KB. */
	readonly descriptor: VectorStoreRecord;
	readonly documentUid: string;
}

/**
 * KB-scoped sibling of {@link runIngest}. Same chunk → embed → upsert
 * pipeline; differs only in which document table it patches and which
 * scope key gets stamped on each chunk's payload.
 */
export async function runKbIngest(
	deps: IngestPipelineDeps,
	ctx: KbIngestContext,
	input: IngestInput,
	onProgress?: (p: IngestProgress) => void,
): Promise<IngestResult> {
	const { store, drivers, embedders } = deps;
	const { workspace, knowledgeBase, descriptor, documentUid } = ctx;
	const kbId = knowledgeBase.knowledgeBaseId;

	const chunkingService = await store.getChunkingService(
		workspace.uid,
		knowledgeBase.chunkingServiceId,
	);
	if (!chunkingService) {
		throw new Error(
			`chunking service '${knowledgeBase.chunkingServiceId}' not found`,
		);
	}
	const chunker = buildChunker(chunkingService, input.chunker);
	const chunks = chunker.chunk({
		text: input.text,
		metadata: input.metadata,
	});

	await store.updateRagDocument(workspace.uid, kbId, documentUid, {
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
						[KB_SCOPE_KEY]: kbId,
						[DOCUMENT_SCOPE_KEY]: documentUid,
						[CHUNK_INDEX_KEY]: chunk.index,
						[CHUNK_TEXT_KEY]: chunk.text,
					},
				})),
			});
		}
		onProgress?.({ processed: chunks.length, total: chunks.length });
		await store.updateRagDocument(workspace.uid, kbId, documentUid, {
			status: "ready",
			ingestedAt: new Date().toISOString(),
		});
		return { chunks: chunks.length };
	} catch (err) {
		await store
			.updateRagDocument(workspace.uid, kbId, documentUid, {
				status: "failed",
				errorMessage: safeErrorMessage(err),
			})
			.catch(() => undefined);
		throw err;
	}
}

function buildChunker(
	service: ChunkingServiceRecord,
	override?: ChunkerOptions,
): Chunker {
	const options: ChunkerOptions = {
		...chunkerOptionsFromService(service),
		...override,
	};
	if (service.engine !== "langchain_ts") {
		throw new Error(
			`chunking service '${service.name}' uses unsupported engine '${service.engine}'`,
		);
	}
	switch (service.strategy ?? "recursive") {
		case "recursive":
			return new RecursiveCharacterChunker(options);
		case "line":
			return new LineChunker(options);
		default:
			throw new Error(
				`chunking service '${service.name}' uses unsupported strategy '${service.strategy}'`,
			);
	}
}

function chunkerOptionsFromService(
	service: ChunkingServiceRecord,
): ChunkerOptions {
	return {
		...(service.maxChunkSize !== null
			? { maxChars: service.maxChunkSize }
			: {}),
		...(service.minChunkSize !== null
			? { minChars: service.minChunkSize }
			: {}),
		...(service.overlapSize !== null
			? { overlapChars: service.overlapSize }
			: {}),
	};
}
