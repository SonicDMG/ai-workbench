"""``/api/v1/workspaces/{workspace_id}/vector-stores`` — vector-store
descriptor CRUD.

Provisioning the underlying Data API Collection happens when ``POST``
returns 201 — the response represents the descriptor row only; actual
vector data is manipulated via the Phase 1b search endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter

from workbench.errors import NotImplementedApiError
from workbench.models import (
    CreateVectorStoreInput,
    UpdateVectorStoreInput,
    VectorStoreRecord,
)

router = APIRouter()


@router.get(
    "/{workspace_id}/vector-stores",
    response_model=list[VectorStoreRecord],
    summary="List vector stores in a workspace",
)
async def list_vector_stores(workspace_id: str) -> list[VectorStoreRecord]:
    raise NotImplementedApiError(f"GET /api/v1/workspaces/{workspace_id}/vector-stores")


@router.post(
    "/{workspace_id}/vector-stores",
    response_model=VectorStoreRecord,
    status_code=201,
    summary="Create a vector store",
)
async def create_vector_store(
    workspace_id: str, _body: CreateVectorStoreInput
) -> VectorStoreRecord:
    raise NotImplementedApiError(f"POST /api/v1/workspaces/{workspace_id}/vector-stores")


@router.get(
    "/{workspace_id}/vector-stores/{vector_store_id}",
    response_model=VectorStoreRecord,
    summary="Get a vector store",
)
async def get_vector_store(workspace_id: str, vector_store_id: str) -> VectorStoreRecord:
    raise NotImplementedApiError(
        f"GET /api/v1/workspaces/{workspace_id}/vector-stores/{vector_store_id}"
    )


@router.put(
    "/{workspace_id}/vector-stores/{vector_store_id}",
    response_model=VectorStoreRecord,
    summary="Update a vector store",
)
async def update_vector_store(
    workspace_id: str, vector_store_id: str, _body: UpdateVectorStoreInput
) -> VectorStoreRecord:
    raise NotImplementedApiError(
        f"PUT /api/v1/workspaces/{workspace_id}/vector-stores/{vector_store_id}"
    )


@router.delete(
    "/{workspace_id}/vector-stores/{vector_store_id}",
    status_code=204,
    summary="Delete a vector store",
)
async def delete_vector_store(workspace_id: str, vector_store_id: str) -> None:
    raise NotImplementedApiError(
        f"DELETE /api/v1/workspaces/{workspace_id}/vector-stores/{vector_store_id}"
    )
