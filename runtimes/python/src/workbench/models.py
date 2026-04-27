"""Pydantic models for the Python runtime's API surface.

Mirrors ``runtimes/typescript/src/control-plane/types.ts`` in the
canonical TypeScript runtime. FastAPI uses these for request/response
validation and OpenAPI generation.

Naming conventions:
  - TS ``camelCase`` -> Python ``snake_case`` internally.
  - JSON over the wire uses camelCase via ``alias_generator=to_camel``.
  - All records are frozen.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# ---- Enums (literal unions) ---- #

WorkspaceKind = Literal["astra", "hcd", "openrag", "mock"]
VectorSimilarity = Literal["cosine", "dot", "euclidean"]
DistanceMetric = Literal["cosine", "dot", "euclidean"]
DocumentStatus = Literal["pending", "chunking", "embedding", "writing", "ready", "failed"]
ServiceStatus = Literal["active", "deprecated", "experimental"]
KnowledgeBaseStatus = Literal["active", "draft", "deprecated"]
AuthType = Literal["none", "api_key", "oauth2", "mTLS"]
AgentRole = Literal["user", "agent", "tool", "system"]

# ---- Secret refs ---- #

SecretRef = str
"""A secret pointer of the form ``'<provider>:<path>'``."""


class _Base(BaseModel):
    """Shared Pydantic config: frozen records, camelCase JSON aliases."""

    model_config = ConfigDict(
        frozen=True,
        populate_by_name=True,
        alias_generator=to_camel,
    )


# ---- Workspace ---- #


class WorkspaceRecord(_Base):
    uid: str
    name: str
    url: str | None
    kind: WorkspaceKind
    credentials: dict[str, SecretRef] = Field(default_factory=dict)
    namespace: str | None
    created_at: str
    updated_at: str


class CreateWorkspaceInput(_Base):
    uid: str | None = None
    name: str
    url: str | None = None
    kind: WorkspaceKind
    credentials: dict[str, SecretRef] | None = None
    namespace: str | None = None


class UpdateWorkspaceInput(_Base):
    name: str | None = None
    url: str | None = None
    credentials: dict[str, SecretRef] | None = None
    namespace: str | None = None


# ---- Knowledge bases ---- #


class LexicalConfig(_Base):
    enabled: bool
    analyzer: str | None = None
    options: dict[str, str] = Field(default_factory=dict)


class KnowledgeBaseRecord(_Base):
    workspace_id: str
    knowledge_base_id: str
    name: str
    description: str | None
    status: KnowledgeBaseStatus
    embedding_service_id: str
    chunking_service_id: str
    reranking_service_id: str | None
    language: str | None
    vector_collection: str | None
    lexical: LexicalConfig
    created_at: str
    updated_at: str


class CreateKnowledgeBaseInput(_Base):
    uid: str | None = None
    name: str
    description: str | None = None
    status: KnowledgeBaseStatus | None = None
    embedding_service_id: str
    chunking_service_id: str
    reranking_service_id: str | None = None
    language: str | None = None
    vector_collection: str | None = None
    lexical: LexicalConfig | None = None


class UpdateKnowledgeBaseInput(_Base):
    name: str | None = None
    description: str | None = None
    status: KnowledgeBaseStatus | None = None
    embedding_service_id: str | None = None
    chunking_service_id: str | None = None
    reranking_service_id: str | None = None
    language: str | None = None
    lexical: LexicalConfig | None = None


class KnowledgeFilterRecord(_Base):
    workspace_id: str
    knowledge_base_id: str
    knowledge_filter_id: str
    name: str
    description: str | None
    filter: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str


class CreateKnowledgeFilterInput(_Base):
    uid: str | None = None
    name: str
    description: str | None = None
    filter: dict[str, Any] = Field(default_factory=dict)


class UpdateKnowledgeFilterInput(_Base):
    name: str | None = None
    description: str | None = None
    filter: dict[str, Any] | None = None


# ---- Execution services ---- #


class ServiceEndpointConfig(_Base):
    endpoint_base_url: str | None = None
    endpoint_path: str | None = None
    request_timeout_ms: int | None = None
    auth_type: AuthType = "none"
    credential_ref: SecretRef | None = None


class ChunkingServiceRecord(ServiceEndpointConfig):
    workspace_id: str
    chunking_service_id: str
    name: str
    description: str | None
    status: ServiceStatus
    engine: str
    engine_version: str | None
    strategy: str | None
    max_chunk_size: int | None
    min_chunk_size: int | None
    chunk_unit: str | None
    overlap_size: int | None
    overlap_unit: str | None
    preserve_structure: bool | None
    language: str | None
    max_payload_size_kb: int | None
    enable_ocr: bool | None
    extract_tables: bool | None
    extract_figures: bool | None
    reading_order: str | None
    created_at: str
    updated_at: str


class CreateChunkingServiceInput(ServiceEndpointConfig):
    uid: str | None = None
    name: str
    description: str | None = None
    status: ServiceStatus | None = None
    engine: str
    engine_version: str | None = None
    strategy: str | None = None
    max_chunk_size: int | None = None
    min_chunk_size: int | None = None
    chunk_unit: str | None = None
    overlap_size: int | None = None
    overlap_unit: str | None = None
    preserve_structure: bool | None = None
    language: str | None = None
    max_payload_size_kb: int | None = None
    enable_ocr: bool | None = None
    extract_tables: bool | None = None
    extract_figures: bool | None = None
    reading_order: str | None = None


class UpdateChunkingServiceInput(ServiceEndpointConfig):
    name: str | None = None
    description: str | None = None
    status: ServiceStatus | None = None
    engine: str | None = None
    engine_version: str | None = None
    strategy: str | None = None
    max_chunk_size: int | None = None
    min_chunk_size: int | None = None
    chunk_unit: str | None = None
    overlap_size: int | None = None
    overlap_unit: str | None = None
    preserve_structure: bool | None = None
    language: str | None = None
    max_payload_size_kb: int | None = None
    enable_ocr: bool | None = None
    extract_tables: bool | None = None
    extract_figures: bool | None = None
    reading_order: str | None = None


class EmbeddingServiceRecord(ServiceEndpointConfig):
    workspace_id: str
    embedding_service_id: str
    name: str
    description: str | None
    status: ServiceStatus
    provider: str
    model_name: str
    embedding_dimension: int
    distance_metric: DistanceMetric
    max_batch_size: int | None
    max_input_tokens: int | None
    supported_languages: list[str] = Field(default_factory=list)
    supported_content: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class CreateEmbeddingServiceInput(ServiceEndpointConfig):
    uid: str | None = None
    name: str
    description: str | None = None
    status: ServiceStatus | None = None
    provider: str
    model_name: str
    embedding_dimension: int
    distance_metric: DistanceMetric = "cosine"
    max_batch_size: int | None = None
    max_input_tokens: int | None = None
    supported_languages: list[str] = Field(default_factory=list)
    supported_content: list[str] = Field(default_factory=list)


class UpdateEmbeddingServiceInput(ServiceEndpointConfig):
    name: str | None = None
    description: str | None = None
    status: ServiceStatus | None = None
    provider: str | None = None
    model_name: str | None = None
    embedding_dimension: int | None = None
    distance_metric: DistanceMetric | None = None
    max_batch_size: int | None = None
    max_input_tokens: int | None = None
    supported_languages: list[str] | None = None
    supported_content: list[str] | None = None


class RerankingServiceRecord(ServiceEndpointConfig):
    workspace_id: str
    reranking_service_id: str
    name: str
    description: str | None
    status: ServiceStatus
    provider: str
    engine: str | None
    model_name: str
    model_version: str | None
    max_candidates: int | None
    scoring_strategy: str | None
    score_normalized: bool | None
    return_scores: bool | None
    max_batch_size: int | None
    supported_languages: list[str] = Field(default_factory=list)
    supported_content: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class CreateRerankingServiceInput(ServiceEndpointConfig):
    uid: str | None = None
    name: str
    description: str | None = None
    status: ServiceStatus | None = None
    provider: str
    engine: str | None = None
    model_name: str
    model_version: str | None = None
    max_candidates: int | None = None
    scoring_strategy: str | None = None
    score_normalized: bool | None = None
    return_scores: bool | None = None
    max_batch_size: int | None = None
    supported_languages: list[str] = Field(default_factory=list)
    supported_content: list[str] = Field(default_factory=list)


class UpdateRerankingServiceInput(ServiceEndpointConfig):
    name: str | None = None
    description: str | None = None
    status: ServiceStatus | None = None
    provider: str | None = None
    engine: str | None = None
    model_name: str | None = None
    model_version: str | None = None
    max_candidates: int | None = None
    scoring_strategy: str | None = None
    score_normalized: bool | None = None
    return_scores: bool | None = None
    max_batch_size: int | None = None
    supported_languages: list[str] | None = None
    supported_content: list[str] | None = None


# ---- RAG documents and data plane ---- #


class RagDocumentRecord(_Base):
    workspace_id: str
    knowledge_base_id: str
    document_id: str
    source_doc_id: str | None
    source_filename: str | None
    file_type: str | None
    file_size: int | None
    content_hash: str | None
    chunk_total: int | None
    status: DocumentStatus
    error_message: str | None
    ingested_at: str | None
    updated_at: str
    metadata: dict[str, str] = Field(default_factory=dict)


class CreateRagDocumentInput(_Base):
    uid: str | None = None
    source_doc_id: str | None = None
    source_filename: str | None = None
    file_type: str | None = None
    file_size: int | None = None
    content_hash: str | None = None
    chunk_total: int | None = None
    status: DocumentStatus = "pending"
    error_message: str | None = None
    ingested_at: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class UpdateRagDocumentInput(_Base):
    source_doc_id: str | None = None
    source_filename: str | None = None
    file_type: str | None = None
    file_size: int | None = None
    content_hash: str | None = None
    chunk_total: int | None = None
    status: DocumentStatus | None = None
    error_message: str | None = None
    ingested_at: str | None = None
    metadata: dict[str, str] | None = None


class VectorRecord(_Base):
    id: str
    vector: list[float] | None = None
    text: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class UpsertRecordsInput(_Base):
    records: list[VectorRecord]


class SearchInput(_Base):
    vector: list[float] | None = None
    text: str | None = None
    top_k: int = 10
    filter: dict[str, Any] | None = None
    hybrid: bool | None = None
    rerank: bool | None = None


class IngestInput(_Base):
    source: dict[str, Any]
    metadata: dict[str, str] = Field(default_factory=dict)


class LlmServiceRecord(ServiceEndpointConfig):
    workspace_id: str
    llm_service_id: str
    name: str
    description: str | None
    status: ServiceStatus
    provider: str
    engine: str | None
    model_name: str
    model_version: str | None
    context_window_tokens: int | None
    max_output_tokens: int | None
    temperature_min: float | None
    temperature_max: float | None
    supports_streaming: bool | None
    supports_tools: bool | None
    max_batch_size: int | None
    supported_languages: list[str] = Field(default_factory=list)
    supported_content: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class McpToolRecord(_Base):
    workspace_id: str
    tool_id: str
    name: str
    description: str | None
    tool_type: str
    endpoint_base_url: str | None
    endpoint_path: str | None
    http_method: str | None
    input_schema: dict[str, Any] | None
    output_schema: dict[str, Any] | None
    auth_type: AuthType
    credential_ref: SecretRef | None
    tags: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class AgentRecord(_Base):
    workspace_id: str
    agent_id: str
    name: str
    description: str | None
    system_prompt: str | None
    user_prompt: str | None
    tool_ids: list[str] = Field(default_factory=list)
    rag_enabled: bool
    knowledge_base_ids: list[str] = Field(default_factory=list)
    rag_max_results: int | None
    rag_min_score: float | None
    rerank_enabled: bool
    reranking_service_id: str | None
    rerank_max_results: int | None
    created_at: str
    updated_at: str


class ConversationRecord(_Base):
    workspace_id: str
    agent_id: str
    conversation_id: str
    created_at: str
    title: str | None


class MessageRecord(_Base):
    workspace_id: str
    conversation_id: str
    message_ts: str
    message_id: str
    role: AgentRole
    author_id: str | None
    content: str | None
    tool_id: str | None
    tool_call_payload: dict[str, Any] | None
    tool_response: dict[str, Any] | None
    token_count: int | None
    metadata: dict[str, str] = Field(default_factory=dict)


# ---- Envelopes ---- #


class ErrorPayload(_Base):
    code: str
    message: str
    request_id: str


class ErrorEnvelope(_Base):
    error: ErrorPayload
