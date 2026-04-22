"""``/api/v1/workspaces/{workspace_id}/catalogs/{catalog_id}/documents``
— document CRUD plus the ingest + search entry points.

``PUT`` updates metadata only. Content changes go through ``POST
.../ingest`` (Phase 2+), which may re-chunk and re-embed.
"""

from __future__ import annotations

from fastapi import APIRouter

from workbench.errors import NotImplementedApiError
from workbench.models import DocumentRecord

router = APIRouter()

_BASE = "/{workspace_id}/catalogs/{catalog_id}/documents"


@router.get(
    _BASE,
    response_model=list[DocumentRecord],
    summary="List documents in a catalog",
)
async def list_documents(workspace_id: str, catalog_id: str) -> list[DocumentRecord]:
    raise NotImplementedApiError(
        f"GET /api/v1/workspaces/{workspace_id}/catalogs/{catalog_id}/documents"
    )


@router.post(
    _BASE,
    response_model=DocumentRecord,
    status_code=201,
    summary="Register a document",
)
async def create_document(workspace_id: str, catalog_id: str) -> DocumentRecord:
    raise NotImplementedApiError(
        f"POST /api/v1/workspaces/{workspace_id}/catalogs/{catalog_id}/documents"
    )


@router.get(
    f"{_BASE}/{{document_id}}",
    response_model=DocumentRecord,
    summary="Get a document",
)
async def get_document(workspace_id: str, catalog_id: str, document_id: str) -> DocumentRecord:
    raise NotImplementedApiError(
        f"GET /api/v1/workspaces/{workspace_id}/catalogs/{catalog_id}/documents/{document_id}"
    )


@router.put(
    f"{_BASE}/{{document_id}}",
    response_model=DocumentRecord,
    summary="Update document metadata",
)
async def update_document(workspace_id: str, catalog_id: str, document_id: str) -> DocumentRecord:
    raise NotImplementedApiError(
        f"PUT /api/v1/workspaces/{workspace_id}/catalogs/{catalog_id}/documents/{document_id}"
    )


@router.delete(
    f"{_BASE}/{{document_id}}",
    status_code=204,
    summary="Delete a document",
)
async def delete_document(workspace_id: str, catalog_id: str, document_id: str) -> None:
    raise NotImplementedApiError(
        f"DELETE /api/v1/workspaces/{workspace_id}/catalogs/{catalog_id}/documents/{document_id}"
    )
