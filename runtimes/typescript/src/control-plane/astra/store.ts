/**
 * {@link ../store.ControlPlaneStore} backed by Astra Data API Tables.
 *
 * Holds no state of its own — every operation is a `findOne`,
 * `insertOne`, `updateOne`, or `deleteOne` against the `wb_*` tables
 * declared in {@link ../../astra-client/table-definitions.ts}.
 *
 * Error mapping contract:
 *   - `findOne` → null  → {@link ../errors.ControlPlaneNotFoundError}
 *     on the relevant method.
 *   - Insert of a PK that already exists →
 *     {@link ../errors.ControlPlaneConflictError}. (Astra's insert into
 *     Tables is upsert-by-default, so we check existence first.)
 *
 * Cascade semantics:
 *   - `deleteWorkspace` → `deleteMany` on every dependent partition.
 *     Accepted: partial failure across partitions (no cross-partition
 *     transaction).
 *   - `deleteKnowledgeBase` → `deleteMany` on rag-documents scoped by
 *     (workspace, knowledge_base_id) and the by-status secondary index.
 *
 * The store itself is a thin shell — each aggregate's methods live in
 * a sibling file (`workspaces.ts`, `knowledge-bases.ts`, …) and is
 * composed in by the constructor. Every slice closes over a single
 * shared {@link AstraStoreState} object so cross-aggregate cascades
 * (e.g. `deleteWorkspace`) can reach into every table without adding
 * cross-slice plumbing.
 *
 * This split is the per-aggregate impl follow-through to ADR-0002 for
 * the Astra backend; the memory backend is split the same way under
 * `../memory/`.
 */

import type { TablesBundle } from "../../astra-client/tables.js";
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
import { makeRagDocumentMethods } from "./rag-documents.js";
import { makeRerankingServiceMethods } from "./reranking-services.js";
import type { AstraStoreState } from "./state.js";
import { makeWorkspaceMethods } from "./workspaces.js";

/**
 * Compose every per-aggregate slice into one object satisfying the
 * full {@link ControlPlaneStore} contract.
 */
function buildAstraStore(tables: TablesBundle): ControlPlaneStore {
	const state: AstraStoreState = { tables };
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
	};
}

/**
 * Public class shape. Tests, route handlers, and services import
 * `AstraControlPlaneStore` directly and instantiate it as
 * `new AstraControlPlaneStore(tables)`; the constructor returns a
 * fully-composed store. Methods are forwarded to the per-aggregate
 * slice the constructor wired up.
 *
 * The class/interface declaration-merging is intentional: each
 * `Object.assign` line in the constructor is type-checked against the
 * matching `Repo` return type of the corresponding `make*Methods`
 * factory, and the union of those factories produces exactly the
 * {@link ControlPlaneStore} surface declared on the merged interface
 * below. The "unsafe" failure mode the biome rule warns about — a
 * method declared on the interface but not initialized on the class —
 * is impossible here because the constructor's `buildAstraStore` call
 * must satisfy `ControlPlaneStore` itself, so the type system already
 * enforces that every method is present on `this`.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: methods are populated via Object.assign and the merge is type-checked against ControlPlaneStore
export class AstraControlPlaneStore implements ControlPlaneStore {
	constructor(tables: TablesBundle) {
		Object.assign(this, buildAstraStore(tables));
	}
}

// Forwarded methods are written by the constructor — declare the
// {@link ControlPlaneStore} surface on the instance so consumers see
// the full method set.
export interface AstraControlPlaneStore extends ControlPlaneStore {}
