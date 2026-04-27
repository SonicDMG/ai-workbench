"""Knowledge-base document CRUD and ingest stubs."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from workbench.errors import NotImplementedApiError
from workbench.models import (
    CreateRagDocumentInput,
    IngestInput,
    RagDocumentRecord,
    UpdateRagDocumentInput,
)

router = APIRouter()


@router.get(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/documents",
    response_model=list[RagDocumentRecord],
)
async def list_documents(workspace_id: str, knowledge_base_id: str) -> list[RagDocumentRecord]:
    raise NotImplementedApiError(
        f"GET /api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}/documents"
    )


@router.post(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/documents",
    response_model=RagDocumentRecord,
    status_code=201,
)
async def create_document(
    workspace_id: str, knowledge_base_id: str, _body: CreateRagDocumentInput
) -> RagDocumentRecord:
    raise NotImplementedApiError(
        f"POST /api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}/documents"
    )


@router.post("/{workspace_id}/knowledge-bases/{knowledge_base_id}/ingest")
async def ingest_document(
    workspace_id: str, knowledge_base_id: str, _body: IngestInput
) -> dict[str, Any]:
    raise NotImplementedApiError(
        f"POST /api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}/ingest"
    )


@router.get(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/documents/{document_id}",
    response_model=RagDocumentRecord,
)
async def get_document(
    workspace_id: str, knowledge_base_id: str, document_id: str
) -> RagDocumentRecord:
    raise NotImplementedApiError(
        "GET "
        f"/api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
        f"/documents/{document_id}"
    )


@router.put(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/documents/{document_id}",
    response_model=RagDocumentRecord,
)
async def update_document(
    workspace_id: str,
    knowledge_base_id: str,
    document_id: str,
    _body: UpdateRagDocumentInput,
) -> RagDocumentRecord:
    raise NotImplementedApiError(
        "PUT "
        f"/api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
        f"/documents/{document_id}"
    )


@router.delete(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/documents/{document_id}",
    status_code=204,
)
async def delete_document(workspace_id: str, knowledge_base_id: str, document_id: str) -> None:
    raise NotImplementedApiError(
        "DELETE "
        f"/api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
        f"/documents/{document_id}"
    )


@router.get("/{workspace_id}/knowledge-bases/{knowledge_base_id}/documents/{document_id}/chunks")
async def list_document_chunks(
    workspace_id: str, knowledge_base_id: str, document_id: str
) -> list[dict[str, Any]]:
    raise NotImplementedApiError(
        "GET "
        f"/api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
        f"/documents/{document_id}/chunks"
    )
