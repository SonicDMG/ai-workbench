"""Knowledge-base data-plane stubs."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from workbench.errors import NotImplementedApiError
from workbench.models import SearchInput, UpsertRecordsInput

router = APIRouter()


@router.post("/{workspace_id}/knowledge-bases/{knowledge_base_id}/records")
async def upsert_records(
    workspace_id: str, knowledge_base_id: str, _body: UpsertRecordsInput
) -> dict[str, Any]:
    raise NotImplementedApiError(
        f"POST /api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}/records"
    )


@router.delete(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/records/{record_id}",
    status_code=204,
)
async def delete_record(workspace_id: str, knowledge_base_id: str, record_id: str) -> None:
    raise NotImplementedApiError(
        "DELETE "
        f"/api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
        f"/records/{record_id}"
    )


@router.post("/{workspace_id}/knowledge-bases/{knowledge_base_id}/search")
async def search(workspace_id: str, knowledge_base_id: str, _body: SearchInput) -> dict[str, Any]:
    raise NotImplementedApiError(
        f"POST /api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}/search"
    )
