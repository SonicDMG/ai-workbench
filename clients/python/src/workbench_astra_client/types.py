"""Canonical record types for the Workbench Astra client.

Mirrors ``src/control-plane/types.ts`` in the TypeScript runtime. When
the TS types change, update here in the same PR.

Naming conventions:
  - TS camelCase → Python snake_case.
  - TS ``Record<string, str>`` → Python ``dict[str, str]``.
  - Everything is frozen: records are immutable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

# ---- Enums (literal unions) ---- #

WorkspaceKind = Literal["astra", "hcd", "openrag", "mock"]
VectorSimilarity = Literal["cosine", "dot", "euclidean"]
DocumentStatus = Literal[
    "pending",
    "chunking",
    "embedding",
    "writing",
    "ready",
    "failed",
]

# ---- Secret refs ---- #

SecretRef = str
"""A secret pointer of the form ``'<provider>:<path>'``, resolved at use
time by the runtime's secret provider. Never contains a raw secret."""


# ---- Workspace ---- #


@dataclass(frozen=True, slots=True)
class WorkspaceRecord:
    uid: str
    name: str
    url: str | None
    kind: WorkspaceKind
    credentials_ref: dict[str, SecretRef]
    keyspace: str | None
    created_at: str
    updated_at: str


# ---- Catalog ---- #


@dataclass(frozen=True, slots=True)
class CatalogRecord:
    workspace: str
    uid: str
    name: str
    description: str | None
    vector_store: str | None
    created_at: str
    updated_at: str


# ---- Vector store ---- #


@dataclass(frozen=True, slots=True)
class EmbeddingConfig:
    provider: str
    model: str
    endpoint: str | None
    dimension: int
    secret_ref: SecretRef | None


@dataclass(frozen=True, slots=True)
class LexicalConfig:
    enabled: bool
    analyzer: str | None
    options: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RerankingConfig:
    enabled: bool
    provider: str | None
    model: str | None
    endpoint: str | None
    secret_ref: SecretRef | None


@dataclass(frozen=True, slots=True)
class VectorStoreRecord:
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


# ---- Document ---- #


@dataclass(frozen=True, slots=True)
class DocumentRecord:
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
    metadata: dict[str, str] = field(default_factory=dict)
