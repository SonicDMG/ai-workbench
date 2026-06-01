/**
 * Multi-KB retrieval for the agent chat surface.
 *
 * Given a user message and a conversation's effective KB filter,
 * fan out a vector search across each KB, merge by score, and
 * return a bounded slice for prompt injection. Reuses the existing
 * {@link ../routes/api-v1/search-dispatch.dispatchSearch} helper —
 * the same code path that backs `POST .../knowledge-bases/{kb}/search`.
 *
 * Failure semantics: if a single KB's retrieval fails, we log via
 * the supplied logger and skip that KB rather than aborting the
 * whole reply. Answering with partial context is still better than
 * a hard error in the user's face.
 */

import type { ResolvedPrincipal } from "../auth/types.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import { CHUNK_TEXT_KEY } from "../ingest/payload-keys.js";
import type { Logger } from "../lib/logger.js";
import { resolveKb } from "../routes/api-v1/kb-descriptor.js";
import { dispatchSearch } from "../routes/api-v1/search-dispatch.js";
import {
	type AstraQuerySnapshot,
	type AstraVectorSearchSnapshot,
	buildVectorSearchSnapshot,
} from "../snapshots/types.js";
import type { RetrievedChunk } from "./prompt.js";
import { mergeReadFilter, resolveKbReadPolicy } from "./tools/rlac.js";

// Re-export so existing imports from `chat/retrieval.js` keep working
// while the SPA and other call sites migrate to `snapshots/types.js`.
// New code should import directly from `../snapshots/types.js`.
export type {
	AstraListChunksSnapshot,
	AstraQuerySnapshot,
	AstraVectorSearchSnapshot,
} from "../snapshots/types.js";

export interface RetrieveContextResult {
	readonly chunks: readonly RetrievedChunk[];
	readonly astraQueries: readonly AstraQuerySnapshot[];
}

export interface RetrieveContextDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly logger?: Pick<Logger, "warn" | "debug">;
}

export interface RetrieveContextRequest {
	readonly workspaceId: string;
	/**
	 * Effective KB scope for this turn. Empty / undefined = fall back
	 * to all KBs in the workspace. The caller is responsible for
	 * resolving "fall back to all" — this function takes whatever
	 * list it's given.
	 */
	readonly knowledgeBaseIds: readonly string[];
	readonly query: string;
	/** Top-K chunks per knowledge base. */
	readonly retrievalK: number;
	/**
	 * The caller's resolved RLAC principal (or null). When the KB's policy
	 * is enabled, the per-KB search filter is scoped to this principal so
	 * the agent grounds only on chunks the caller may see. A policy-on KB
	 * with no principal contributes no chunks (fail-soft). Optional
	 * (absent ⇒ null); the chat + MCP callers always set it.
	 */
	readonly principal?: ResolvedPrincipal | null;
}

/**
 * Total context cap = `retrievalK * ceil(sqrt(numKbs))`. One KB ⇒ K
 * chunks, four KBs ⇒ 2K, sixteen KBs ⇒ 4K. Keeps the prompt size
 * sub-linear in the KB fan-out so a workspace with dozens of KBs
 * doesn't blow up a chat-completion call.
 */
function totalContextCap(retrievalK: number, numKbs: number): number {
	if (numKbs <= 1) return retrievalK;
	return Math.ceil(retrievalK * Math.sqrt(numKbs));
}

export async function retrieveContext(
	deps: RetrieveContextDeps,
	request: RetrieveContextRequest,
): Promise<RetrieveContextResult> {
	const knowledgeBaseIds = await effectiveKbSet(deps.store, request);
	if (knowledgeBaseIds.length === 0) {
		return { chunks: [], astraQueries: [] };
	}

	const perKb = await Promise.all(
		knowledgeBaseIds.map(async (kbId) => {
			try {
				const ctx = await resolveKb(deps.store, request.workspaceId, kbId);
				// RLAC: fold the caller's policy filter into the search so
				// the agent only grounds on chunks the caller may see. A
				// policy-on KB with no principal contributes nothing.
				const policy = await resolveKbReadPolicy({
					store: deps.store,
					workspace: ctx.workspace,
					knowledgeBase: ctx.knowledgeBase,
					principal: request.principal,
					action: "search",
					resourceId: "*",
				});
				if (!policy.allow) {
					return { chunks: [] as RetrievedChunk[], snapshot: null };
				}
				const driver = deps.drivers.for(ctx.workspace);
				const hits = await dispatchSearch({
					ctx,
					driver,
					embedders: deps.embedders,
					body: {
						text: request.query,
						topK: request.retrievalK,
						filter: mergeReadFilter(undefined, policy.filter),
					},
				});
				const snapshot =
					ctx.workspace.kind === "astra" || ctx.workspace.kind === "hcd"
						? buildVectorSearchSnapshot({
								envelope: {
									knowledgeBaseId: kbId,
									kbName: ctx.knowledgeBase.name,
									collection: ctx.descriptor.name,
									keyspace: ctx.workspace.keyspace,
								},
								text: request.query,
								topK: request.retrievalK,
							})
						: null;
				return {
					chunks: hits.map((hit) => toChunk(hit, kbId)),
					snapshot,
				};
			} catch (err) {
				deps.logger?.warn?.(
					{
						err,
						workspaceId: request.workspaceId,
						knowledgeBaseId: kbId,
					},
					"chat retrieval failed for knowledge base; skipping",
				);
				return { chunks: [] as RetrievedChunk[], snapshot: null };
			}
		}),
	);

	const cap = totalContextCap(request.retrievalK, knowledgeBaseIds.length);
	const chunks = perKb
		.flatMap((r) => r.chunks)
		.sort((a, b) => b.score - a.score)
		.slice(0, cap);
	const astraQueries = perKb
		.map((r) => r.snapshot)
		.filter((s): s is AstraVectorSearchSnapshot => s !== null);
	return { chunks, astraQueries };
}

/**
 * Resolve the effective KB set for a chat turn. Empty filter falls
 * back to "every KB in the workspace" — the agent can grasp at any
 * available context. A populated filter is honored verbatim, even
 * if some KBs in it have since been deleted; the per-KB retrieval
 * loop will silently skip the dead ones (resolveKb 404s, caught by
 * the try/catch in `retrieveContext`).
 */
async function effectiveKbSet(
	store: ControlPlaneStore,
	request: RetrieveContextRequest,
): Promise<readonly string[]> {
	if (request.knowledgeBaseIds.length > 0) return request.knowledgeBaseIds;
	const all = await store.listKnowledgeBases(request.workspaceId);
	return all.map((kb) => kb.knowledgeBaseId);
}

interface SearchHitLike {
	readonly id: string;
	readonly score: number;
	readonly payload?: Readonly<Record<string, unknown>>;
}

function toChunk(hit: SearchHitLike, knowledgeBaseId: string): RetrievedChunk {
	const payload = hit.payload ?? {};
	const documentId =
		typeof payload.documentId === "string" ? payload.documentId : null;
	// Ingest stamps text under the reserved `CHUNK_TEXT_KEY`. The
	// `content` / `text` fallbacks survive for older data and for
	// drivers that don't round-trip the reserved key — without them,
	// MCP `chat_send` would build an empty context block.
	const reservedText = payload[CHUNK_TEXT_KEY];
	const content =
		typeof reservedText === "string"
			? reservedText
			: typeof payload.content === "string"
				? payload.content
				: typeof payload.text === "string"
					? payload.text
					: "";
	return {
		chunkId: hit.id,
		knowledgeBaseId,
		documentId,
		content,
		score: hit.score,
	};
}
