"""``/api/v1/workspaces/{workspace_id}/catalogs`` — catalog CRUD."""

from __future__ import annotations

from fastapi import APIRouter

from workbench.errors import NotImplementedApiError
from workbench.models import (
    CatalogRecord,
    CreateCatalogInput,
    UpdateCatalogInput,
)

router = APIRouter()


@router.get(
    "/{workspace_id}/catalogs",
    response_model=list[CatalogRecord],
    summary="List catalogs in a workspace",
)
async def list_catalogs(workspace_id: str) -> list[CatalogRecord]:
    raise NotImplementedApiError(f"GET /api/v1/workspaces/{workspace_id}/catalogs")


@router.post(
    "/{workspace_id}/catalogs",
    response_model=CatalogRecord,
    status_code=201,
    summary="Create a catalog",
)
async def create_catalog(workspace_id: str, _body: CreateCatalogInput) -> CatalogRecord:
    raise NotImplementedApiError(f"POST /api/v1/workspaces/{workspace_id}/catalogs")


@router.get(
    "/{workspace_id}/catalogs/{catalog_id}",
    response_model=CatalogRecord,
    summary="Get a catalog",
)
async def get_catalog(workspace_id: str, catalog_id: str) -> CatalogRecord:
    raise NotImplementedApiError(f"GET /api/v1/workspaces/{workspace_id}/catalogs/{catalog_id}")


@router.put(
    "/{workspace_id}/catalogs/{catalog_id}",
    response_model=CatalogRecord,
    summary="Update a catalog",
)
async def update_catalog(
    workspace_id: str, catalog_id: str, _body: UpdateCatalogInput
) -> CatalogRecord:
    raise NotImplementedApiError(f"PUT /api/v1/workspaces/{workspace_id}/catalogs/{catalog_id}")


@router.delete(
    "/{workspace_id}/catalogs/{catalog_id}",
    status_code=204,
    summary="Delete a catalog",
)
async def delete_catalog(workspace_id: str, catalog_id: str) -> None:
    raise NotImplementedApiError(f"DELETE /api/v1/workspaces/{workspace_id}/catalogs/{catalog_id}")
