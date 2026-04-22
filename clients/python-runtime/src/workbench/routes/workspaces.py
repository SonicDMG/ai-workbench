"""``/api/v1/workspaces`` — workspace CRUD.

Scaffold: every handler raises ``NotImplementedApiError`` (returns HTTP
501 via the app-level exception handler). Fill in one handler at a
time; the conformance tests in ``tests/test_conformance.py`` will
start passing as you go.
"""

from __future__ import annotations

from fastapi import APIRouter

from workbench.errors import NotImplementedApiError
from workbench.models import (
    CreateWorkspaceInput,
    UpdateWorkspaceInput,
    WorkspaceRecord,
)

router = APIRouter()


@router.get("", response_model=list[WorkspaceRecord], summary="List workspaces")
async def list_workspaces() -> list[WorkspaceRecord]:
    raise NotImplementedApiError("GET /api/v1/workspaces")


@router.post(
    "",
    response_model=WorkspaceRecord,
    status_code=201,
    summary="Create a workspace",
)
async def create_workspace(_body: CreateWorkspaceInput) -> WorkspaceRecord:
    raise NotImplementedApiError("POST /api/v1/workspaces")


@router.get("/{workspace_id}", response_model=WorkspaceRecord, summary="Get a workspace")
async def get_workspace(workspace_id: str) -> WorkspaceRecord:
    raise NotImplementedApiError(f"GET /api/v1/workspaces/{workspace_id}")


@router.put(
    "/{workspace_id}",
    response_model=WorkspaceRecord,
    summary="Update a workspace",
)
async def update_workspace(workspace_id: str, _body: UpdateWorkspaceInput) -> WorkspaceRecord:
    raise NotImplementedApiError(f"PUT /api/v1/workspaces/{workspace_id}")


@router.delete(
    "/{workspace_id}",
    status_code=204,
    summary="Delete a workspace",
)
async def delete_workspace(workspace_id: str) -> None:
    raise NotImplementedApiError(f"DELETE /api/v1/workspaces/{workspace_id}")
