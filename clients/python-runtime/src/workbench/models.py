"""Pydantic models — canonical record shapes for the Python runtime.

Mirrors ``src/control-plane/types.ts`` in the canonical TypeScript
runtime. FastAPI uses these for request/response validation and OpenAPI
generation. When TS types change, update here in the same PR.

Naming conventions:
  - TS ``camelCase`` → Python ``snake_case`` (on the Python side).
  - JSON over the wire uses camelCase — Pydantic handles the conversion
    via ``alias_generator=to_camel``.
  - All records are frozen (``model_config = {"frozen": True}``).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# ---- Enums (literal unions) ---- #

WorkspaceKind = Literal["astra", "hcd", "openrag", "mock"]
VectorSimilarity = Literal["cosine", "dot", "euclidean"]
DocumentStatus = Literal["pending", "chunking", "embedding", "writing", "ready", "failed"]

# ---- Secret refs ---- #

SecretRef = str
"""A secret pointer of the form ``'<provider>:<path>'``, resolved at use
time by the runtime's secret provider. Never contains a raw secret."""


# ---- Base ---- #


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
    credentials_ref: dict[str, SecretRef] = Field(default_factory=dict)
    keyspace: str | None
    created_at: str
    updated_at: str


class CreateWorkspaceInput(_Base):
    name: str
    kind: WorkspaceKind
    url: str | None = None
    credentials_ref: dict[str, SecretRef] | None = None
    keyspace: str | None = None


class UpdateWorkspaceInput(_Base):
    name: str | None = None
    kind: WorkspaceKind | None = None
    url: str | None = None
    credentials_ref: dict[str, SecretRef] | None = None
    keyspace: str | None = None


# ---- Catalog ---- #


class CatalogRecord(_Base):
    workspace: str
    uid: str
    name: str
    description: str | None
    vector_store: str | None
    created_at: str
    updated_at: str


class CreateCatalogInput(_Base):
    name: str
    description: str | None = None
    vector_store: str | None = None


class UpdateCatalogInput(_Base):
    name: str | None = None
    description: str | None = None
    vector_store: str | None = None


# ---- Vector store ---- #


class EmbeddingConfig(_Base):
    provider: str
    model: str
    endpoint: str | None
    dimension: int
    secret_ref: SecretRef | None


class LexicalConfig(_Base):
    enabled: bool
    analyzer: str | None = None
    options: dict[str, str] = Field(default_factory=dict)


class RerankingConfig(_Base):
    enabled: bool
    provider: str | None = None
    model: str | None = None
    endpoint: str | None = None
    secret_ref: SecretRef | None = None


class VectorStoreRecord(_Base):
    workspace: str
    uid: str
    name: str
    vector_dimension: int
    vector_similarity: VectorSimilarity
    embedding: EmbeddingConfig
    lexical: LexicalConfig
    reranking: RerankingConfig
    created_at: str
    updated_at: str


class CreateVectorStoreInput(_Base):
    name: str
    vector_dimension: int
    embedding: EmbeddingConfig
    vector_similarity: VectorSimilarity = "cosine"
    lexical: LexicalConfig | None = None
    reranking: RerankingConfig | None = None


class UpdateVectorStoreInput(_Base):
    name: str | None = None
    vector_dimension: int | None = None
    vector_similarity: VectorSimilarity | None = None
    embedding: EmbeddingConfig | None = None
    lexical: LexicalConfig | None = None
    reranking: RerankingConfig | None = None


# ---- Document ---- #


class DocumentRecord(_Base):
    workspace: str
    catalog_uid: str
    document_uid: str
    source_doc_id: str | None
    source_filename: str | None
    file_type: str | None
    file_size: int | None
    md5_hash: str | None
    chunk_total: int | None
    ingested_at: str | None
    updated_at: str
    status: DocumentStatus
    error_message: str | None
    metadata: dict[str, str] = Field(default_factory=dict)


# ---- Envelopes ---- #


class ErrorPayload(_Base):
    code: str
    message: str
    request_id: str


class ErrorEnvelope(_Base):
    error: ErrorPayload
