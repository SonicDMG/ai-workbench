/**
 * JSON-on-disk {@link ../store.ControlPlaneStore} for single-node
 * self-hosted deployments.
 *
 * Layout:
 *   <root>/workspaces.json          : WorkspaceRecord[]
 *   <root>/api-keys.json            : ApiKeyRecord[]
 *   <root>/knowledge-bases.json     : KnowledgeBaseRecord[]
 *   <root>/chunking-services.json   : ChunkingServiceRecord[]
 *   <root>/embedding-services.json  : EmbeddingServiceRecord[]
 *   <root>/reranking-services.json  : RerankingServiceRecord[]
 *   <root>/llm-services.json        : LlmServiceRecord[]
 *   <root>/rag-documents.json       : RagDocumentRecord[]
 *
 * Each mutation:
 *   1. Acquires the per-file mutex.
 *   2. Reads the file (creating an empty array if absent).
 *   3. Applies the change in memory.
 *   4. Writes to `<file>.tmp` then atomically renames over `<file>`.
 *
 * Not safe for multi-writer setups (multiple processes writing the
 * same directory) — that's what the astra backend is for.
 *
 * The store itself is a thin shell — each aggregate's methods live in
 * a sibling file (`workspaces.ts`, `knowledge-bases.ts`, …) and is
 * composed in by the constructor. Every slice closes over a single
 * shared {@link FileStoreState} object so cross-aggregate cascades
 * (e.g. `deleteWorkspace`) can reach into every partition without
 * adding cross-slice plumbing.
 *
 * This is the per-aggregate impl follow-through to ADR-0002 for the
 * file backend, mirroring the memory split (PR #199).
 */

import { mkdir } from "node:fs/promises";
import type { ControlPlaneStore } from "../store.js";
import { makeAgentMethods } from "./agents.js";
import { makeApiKeyMethods } from "./api-keys.js";
import { makeChatMessageMethods } from "./chat-messages.js";
import { makeChunkingServiceMethods } from "./chunking-services.js";
import { makeConversationMethods } from "./conversations.js";
import { makeEmbeddingServiceMethods } from "./embedding-services.js";
import { makeKnowledgeBaseMethods } from "./knowledge-bases.js";
import { makeKnowledgeFilterMethods } from "./knowledge-filters.js";
import { makeLlmServiceMethods } from "./llm-services.js";
import { makeMcpServerMethods } from "./mcp-servers.js";
import { makePolicyAuditMethods } from "./policy-audit.js";
import { makePrincipalMethods } from "./principals.js";
import { makeRagDocumentMethods } from "./rag-documents.js";
import { makeRerankingServiceMethods } from "./reranking-services.js";
import { createFileStoreState, type FileStoreState } from "./state.js";
import { makeWorkspaceMethods } from "./workspaces.js";

export interface FileControlPlaneOptions {
	readonly root: string;
}

/**
 * Compose every per-aggregate slice into one object satisfying the
 * full {@link ControlPlaneStore} contract.
 */
function buildFileStore(state: FileStoreState): ControlPlaneStore {
	return {
		...makeWorkspaceMethods(state),
		...makeApiKeyMethods(state),
		...makeRagDocumentMethods(state),
		...makeKnowledgeBaseMethods(state),
		...makeKnowledgeFilterMethods(state),
		...makeChunkingServiceMethods(state),
		...makeEmbeddingServiceMethods(state),
		...makeRerankingServiceMethods(state),
		...makeLlmServiceMethods(state),
		...makeAgentMethods(state),
		...makeConversationMethods(state),
		...makeChatMessageMethods(state),
		...makePrincipalMethods(state),
		...makeMcpServerMethods(state),
		...makePolicyAuditMethods(state),
	};
}

/**
 * Public class shape. Tests, route handlers, and services import
 * `FileControlPlaneStore` directly and instantiate it as
 * `new FileControlPlaneStore({ root })`; the constructor returns a
 * fully-composed JSON-on-disk store. Methods are forwarded to the
 * per-aggregate slice the constructor wired up.
 *
 * The class/interface declaration-merging is intentional: each slice
 * factory's return type is checked against the matching `Repo`
 * subset of {@link ControlPlaneStore}, and `buildFileStore` itself is
 * checked against the full surface — so the merged interface below
 * is guaranteed to be populated by the time the constructor returns.
 * See the matching pattern in `../memory/store.ts`.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: methods are populated via Object.assign and the merge is type-checked against ControlPlaneStore
export class FileControlPlaneStore implements ControlPlaneStore {
	private readonly root: string;

	constructor(opts: FileControlPlaneOptions) {
		this.root = opts.root;
		Object.assign(this, buildFileStore(createFileStoreState(opts.root)));
	}

	async init(): Promise<void> {
		await mkdir(this.root, { recursive: true });
	}
}

// Forwarded methods are written by the constructor — declare the
// {@link ControlPlaneStore} surface on the instance so consumers see
// the full method set.
export interface FileControlPlaneStore extends ControlPlaneStore {}
