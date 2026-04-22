"""Control-plane operations: CRUD on ``wb_*`` Data API tables.

Mirrors the TypeScript ``src/astra-client/control-plane.ts`` (Phase
1a.2). Every method here corresponds to one operation in
``clients/conformance/scenarios.md`` and must emit a byte-identical HTTP
request to the reference TS client.

All methods currently raise ``NotImplementedError``. Fill in each one,
re-run the conformance tests, and iterate until the diff goes to zero.
"""

from __future__ import annotations

from workbench_astra_client._http import AstraHttp
from workbench_astra_client.types import (
    CatalogRecord,
    DocumentRecord,
    EmbeddingConfig,
    LexicalConfig,
    RerankingConfig,
    SecretRef,
    VectorSimilarity,
    VectorStoreRecord,
    WorkspaceKind,
    WorkspaceRecord,
)

# Table names — match the CQL DDL in the TS runtime. DO NOT drift.
TABLE_WORKSPACES = "wb_workspaces"
TABLE_CATALOGS = "wb_catalog_by_workspace"
TABLE_VECTOR_STORES = "wb_vector_store_by_workspace"
TABLE_DOCUMENTS = "wb_documents_by_catalog"


class Workspaces:
    """CRUD on ``wb_workspaces``."""

    def __init__(self, http: AstraHttp) -> None:
        self._http = http

    def list(self) -> list[WorkspaceRecord]:  # noqa: A003
        raise NotImplementedError("Workspaces.list — scaffolded")

    def get(self, uid: str) -> WorkspaceRecord | None:
        raise NotImplementedError("Workspaces.get — scaffolded")

    def create(
        self,
        *,
        name: str,
        kind: WorkspaceKind,
        url: str | None = None,
        credentials_ref: dict[str, SecretRef] | None = None,
        keyspace: str | None = None,
    ) -> WorkspaceRecord:
        raise NotImplementedError("Workspaces.create — scaffolded")

    def update(
        self,
        uid: str,
        *,
        name: str | None = None,
        url: str | None = None,
        kind: WorkspaceKind | None = None,
        credentials_ref: dict[str, SecretRef] | None = None,
        keyspace: str | None = None,
    ) -> WorkspaceRecord:
        raise NotImplementedError("Workspaces.update — scaffolded")

    def delete(self, uid: str) -> bool:
        raise NotImplementedError("Workspaces.delete — scaffolded")


class Catalogs:
    """CRUD on ``wb_catalog_by_workspace``."""

    def __init__(self, http: AstraHttp) -> None:
        self._http = http

    def list(self, *, workspace: str) -> list[CatalogRecord]:  # noqa: A003
        raise NotImplementedError("Catalogs.list — scaffolded")

    def get(self, *, workspace: str, uid: str) -> CatalogRecord | None:
        raise NotImplementedError("Catalogs.get — scaffolded")

    def create(
        self,
        *,
        workspace: str,
        name: str,
        description: str | None = None,
        vector_store: str | None = None,
    ) -> CatalogRecord:
        raise NotImplementedError("Catalogs.create — scaffolded")

    def update(
        self,
        *,
        workspace: str,
        uid: str,
        name: str | None = None,
        description: str | None = None,
        vector_store: str | None = None,
    ) -> CatalogRecord:
        raise NotImplementedError("Catalogs.update — scaffolded")

    def delete(self, *, workspace: str, uid: str) -> bool:
        raise NotImplementedError("Catalogs.delete — scaffolded")


class VectorStores:
    """CRUD on ``wb_vector_store_by_workspace`` — the DEFINITION rows.

    Provisioning the underlying Data API Collection is a separate
    concern; see ``data_plane.Collections.provision``.
    """

    def __init__(self, http: AstraHttp) -> None:
        self._http = http

    def list(self, *, workspace: str) -> list[VectorStoreRecord]:  # noqa: A003
        raise NotImplementedError("VectorStores.list — scaffolded")

    def get(self, *, workspace: str, uid: str) -> VectorStoreRecord | None:
        raise NotImplementedError("VectorStores.get — scaffolded")

    def create(
        self,
        *,
        workspace: str,
        name: str,
        vector_dimension: int,
        embedding: EmbeddingConfig,
        vector_similarity: VectorSimilarity = "cosine",
        lexical: LexicalConfig | None = None,
        reranking: RerankingConfig | None = None,
    ) -> VectorStoreRecord:
        raise NotImplementedError("VectorStores.create — scaffolded")

    def update(
        self,
        *,
        workspace: str,
        uid: str,
        name: str | None = None,
        vector_dimension: int | None = None,
        vector_similarity: VectorSimilarity | None = None,
        embedding: EmbeddingConfig | None = None,
        lexical: LexicalConfig | None = None,
        reranking: RerankingConfig | None = None,
    ) -> VectorStoreRecord:
        raise NotImplementedError("VectorStores.update — scaffolded")

    def delete(self, *, workspace: str, uid: str) -> bool:
        raise NotImplementedError("VectorStores.delete — scaffolded")


class Documents:
    """CRUD on ``wb_documents_by_catalog``."""

    def __init__(self, http: AstraHttp) -> None:
        self._http = http

    def list(  # noqa: A003
        self, *, workspace: str, catalog: str
    ) -> list[DocumentRecord]:
        raise NotImplementedError("Documents.list — scaffolded")

    def get(
        self, *, workspace: str, catalog: str, uid: str
    ) -> DocumentRecord | None:
        raise NotImplementedError("Documents.get — scaffolded")

    def create(
        self,
        *,
        workspace: str,
        catalog: str,
        source_filename: str | None = None,
        source_doc_id: str | None = None,
        file_type: str | None = None,
        file_size: int | None = None,
        md5_hash: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> DocumentRecord:
        raise NotImplementedError("Documents.create — scaffolded")

    def update(
        self,
        *,
        workspace: str,
        catalog: str,
        uid: str,
        # PUT = metadata-only updates per the API spec (content changes
        # go through the ingest pipeline instead).
        source_filename: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> DocumentRecord:
        raise NotImplementedError("Documents.update — scaffolded")

    def delete(self, *, workspace: str, catalog: str, uid: str) -> bool:
        raise NotImplementedError("Documents.delete — scaffolded")


__all__ = [
    "Catalogs",
    "Documents",
    "VectorStores",
    "Workspaces",
]
