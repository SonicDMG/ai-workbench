"""Knowledge-filter CRUD stubs."""

from __future__ import annotations

from fastapi import APIRouter

from workbench.errors import NotImplementedApiError
from workbench.models import (
    CreateKnowledgeFilterInput,
    KnowledgeFilterRecord,
    UpdateKnowledgeFilterInput,
)

router = APIRouter()


@router.get(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/filters",
    response_model=list[KnowledgeFilterRecord],
)
async def list_knowledge_filters(
    workspace_id: str, knowledge_base_id: str
) -> list[KnowledgeFilterRecord]:
    raise NotImplementedApiError(
        f"GET /api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}/filters"
    )


@router.post(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/filters",
    response_model=KnowledgeFilterRecord,
    status_code=201,
)
async def create_knowledge_filter(
    workspace_id: str,
    knowledge_base_id: str,
    _body: CreateKnowledgeFilterInput,
) -> KnowledgeFilterRecord:
    raise NotImplementedApiError(
        f"POST /api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}/filters"
    )


@router.get(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/filters/{knowledge_filter_id}",
    response_model=KnowledgeFilterRecord,
)
async def get_knowledge_filter(
    workspace_id: str,
    knowledge_base_id: str,
    knowledge_filter_id: str,
) -> KnowledgeFilterRecord:
    raise NotImplementedApiError(
        "GET "
        f"/api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
        f"/filters/{knowledge_filter_id}"
    )


@router.put(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/filters/{knowledge_filter_id}",
    response_model=KnowledgeFilterRecord,
)
async def update_knowledge_filter(
    workspace_id: str,
    knowledge_base_id: str,
    knowledge_filter_id: str,
    _body: UpdateKnowledgeFilterInput,
) -> KnowledgeFilterRecord:
    raise NotImplementedApiError(
        "PUT "
        f"/api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
        f"/filters/{knowledge_filter_id}"
    )


@router.delete(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}/filters/{knowledge_filter_id}",
    status_code=204,
)
async def delete_knowledge_filter(
    workspace_id: str,
    knowledge_base_id: str,
    knowledge_filter_id: str,
) -> None:
    raise NotImplementedApiError(
        "DELETE "
        f"/api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
        f"/filters/{knowledge_filter_id}"
    )
