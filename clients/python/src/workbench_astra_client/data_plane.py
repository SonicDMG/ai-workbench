"""Data-plane operations: Data API Collection provisioning and search.

Corresponds to ``src/astra-client/data-plane.ts`` (Phase 1b). Separate
from control-plane because a vector store has two physical artefacts:

  1. A row in ``wb_vector_store_by_workspace`` (the DEFINITION, handled
     by :mod:`workbench_astra_client.control_plane`).
  2. A Data API Collection (the actual vector data, handled here).

Both are created transactionally when the user calls
``POST /api/v1/workspaces/{w}/vector-stores`` on the runtime.

Scaffold only — implementations land in Phase 1b.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import TypedDict

from workbench_astra_client._http import AstraHttp


class VectorRecord(TypedDict, total=False):
    """A single (id, vector, payload) triple to upsert."""

    id: str
    vector: list[float]
    payload: dict[str, object]


class SearchHit(TypedDict, total=False):
    id: str
    score: float
    payload: dict[str, object]
    vector: list[float]


class Collections:
    """Provision + interact with the Data API Collection backing a
    vector store."""

    def __init__(self, http: AstraHttp) -> None:
        self._http = http

    def provision(self, *, workspace: str, vector_store: str) -> None:
        """Create the underlying Data API Collection for an existing
        vector-store DEFINITION row. Idempotent."""
        raise NotImplementedError("Collections.provision — Phase 1b")

    def upsert(
        self,
        *,
        workspace: str,
        vector_store: str,
        records: Iterable[VectorRecord],
    ) -> int:
        """Upsert records into the collection. Returns count upserted."""
        raise NotImplementedError("Collections.upsert — Phase 1b")

    def search(
        self,
        *,
        workspace: str,
        vector_store: str,
        vector: list[float],
        top_k: int = 10,
        filter: dict[str, object] | None = None,  # noqa: A002
        include_embeddings: bool = False,
    ) -> list[SearchHit]:
        raise NotImplementedError("Collections.search — Phase 1b")

    def delete_record(
        self, *, workspace: str, vector_store: str, record_id: str
    ) -> bool:
        raise NotImplementedError("Collections.delete_record — Phase 1b")


__all__ = ["Collections", "SearchHit", "VectorRecord"]
