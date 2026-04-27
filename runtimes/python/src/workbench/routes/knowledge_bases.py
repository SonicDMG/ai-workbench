"""Knowledge-base CRUD stubs."""

from __future__ import annotations

from fastapi import APIRouter

from workbench.errors import NotImplementedApiError
from workbench.models import (
    CreateKnowledgeBaseInput,
    KnowledgeBaseRecord,
    UpdateKnowledgeBaseInput,
)

router = APIRouter()


@router.get("/{workspace_id}/knowledge-bases", response_model=list[KnowledgeBaseRecord])
async def list_knowledge_bases(workspace_id: str) -> list[KnowledgeBaseRecord]:
    raise NotImplementedApiError(f"GET /api/v1/workspaces/{workspace_id}/knowledge-bases")


@router.post(
    "/{workspace_id}/knowledge-bases",
    response_model=KnowledgeBaseRecord,
    status_code=201,
)
async def create_knowledge_base(
    workspace_id: str, _body: CreateKnowledgeBaseInput
) -> KnowledgeBaseRecord:
    raise NotImplementedApiError(f"POST /api/v1/workspaces/{workspace_id}/knowledge-bases")


@router.get(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}",
    response_model=KnowledgeBaseRecord,
)
async def get_knowledge_base(workspace_id: str, knowledge_base_id: str) -> KnowledgeBaseRecord:
    raise NotImplementedApiError(
        f"GET /api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
    )


@router.put(
    "/{workspace_id}/knowledge-bases/{knowledge_base_id}",
    response_model=KnowledgeBaseRecord,
)
async def update_knowledge_base(
    workspace_id: str,
    knowledge_base_id: str,
    _body: UpdateKnowledgeBaseInput,
) -> KnowledgeBaseRecord:
    raise NotImplementedApiError(
        f"PUT /api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
    )


@router.delete("/{workspace_id}/knowledge-bases/{knowledge_base_id}", status_code=204)
async def delete_knowledge_base(workspace_id: str, knowledge_base_id: str) -> None:
    raise NotImplementedApiError(
        f"DELETE /api/v1/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}"
    )
