/**
 * Per-aggregate repository interfaces for the control plane.
 *
 * Each aggregate exports its repo interface plus the `Create*Input` /
 * `Update*Input` types that go with it. {@link ../store.ControlPlaneStore}
 * composes all twelve into the canonical full-store contract via
 * `extends`; consumers that only touch one aggregate (e.g. a service
 * that just needs `KnowledgeBaseRepo`) can declare that narrower
 * dependency directly.
 *
 * The implementation files (memory/file/astra) still satisfy the full
 * `ControlPlaneStore`; per-aggregate impl extraction is queued for a
 * follow-up PR.
 */

export type {
	AgentRepo,
	CreateAgentInput,
	UpdateAgentInput,
} from "./agents.js";
export type { ApiKeyRepo, PersistApiKeyInput } from "./api-keys.js";
export type {
	AppendChatMessageInput,
	ChatMessageRepo,
	UpdateChatMessageInput,
} from "./chat-messages.js";
export type {
	ChunkingServiceRepo,
	CreateChunkingServiceInput,
	UpdateChunkingServiceInput,
} from "./chunking-services.js";
export type {
	ConversationRepo,
	CreateConversationInput,
	UpdateConversationInput,
} from "./conversations.js";
export type {
	CreateEmbeddingServiceInput,
	EmbeddingServiceRepo,
	UpdateEmbeddingServiceInput,
} from "./embedding-services.js";
export type {
	CreateKnowledgeBaseInput,
	KnowledgeBaseRepo,
	UpdateKnowledgeBaseInput,
} from "./knowledge-bases.js";
export type {
	CreateKnowledgeFilterInput,
	KnowledgeFilterRepo,
	UpdateKnowledgeFilterInput,
} from "./knowledge-filters.js";
export type {
	CreateLlmServiceInput,
	LlmServiceRepo,
	UpdateLlmServiceInput,
} from "./llm-services.js";
export type {
	CreateRagDocumentInput,
	RagDocumentRepo,
	UpdateRagDocumentInput,
} from "./rag-documents.js";
export type {
	CreateRerankingServiceInput,
	RerankingServiceRepo,
	UpdateRerankingServiceInput,
} from "./reranking-services.js";
export type {
	CreateWorkspaceInput,
	UpdateWorkspaceInput,
	WorkspaceRepo,
} from "./workspaces.js";
