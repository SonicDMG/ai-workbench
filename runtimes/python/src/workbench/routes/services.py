"""Execution-service CRUD stubs."""

from __future__ import annotations

from fastapi import APIRouter

from workbench.errors import NotImplementedApiError
from workbench.models import (
    ChunkingServiceRecord,
    CreateChunkingServiceInput,
    CreateEmbeddingServiceInput,
    CreateRerankingServiceInput,
    EmbeddingServiceRecord,
    RerankingServiceRecord,
    UpdateChunkingServiceInput,
    UpdateEmbeddingServiceInput,
    UpdateRerankingServiceInput,
)

router = APIRouter()


@router.get("/{workspace_id}/chunking-services", response_model=list[ChunkingServiceRecord])
async def list_chunking_services(workspace_id: str) -> list[ChunkingServiceRecord]:
    raise NotImplementedApiError(f"GET /api/v1/workspaces/{workspace_id}/chunking-services")


@router.post(
    "/{workspace_id}/chunking-services",
    response_model=ChunkingServiceRecord,
    status_code=201,
)
async def create_chunking_service(
    workspace_id: str, _body: CreateChunkingServiceInput
) -> ChunkingServiceRecord:
    raise NotImplementedApiError(f"POST /api/v1/workspaces/{workspace_id}/chunking-services")


@router.get(
    "/{workspace_id}/chunking-services/{chunking_service_id}",
    response_model=ChunkingServiceRecord,
)
async def get_chunking_service(
    workspace_id: str, chunking_service_id: str
) -> ChunkingServiceRecord:
    raise NotImplementedApiError(
        f"GET /api/v1/workspaces/{workspace_id}/chunking-services/{chunking_service_id}"
    )


@router.put(
    "/{workspace_id}/chunking-services/{chunking_service_id}",
    response_model=ChunkingServiceRecord,
)
async def update_chunking_service(
    workspace_id: str,
    chunking_service_id: str,
    _body: UpdateChunkingServiceInput,
) -> ChunkingServiceRecord:
    raise NotImplementedApiError(
        f"PUT /api/v1/workspaces/{workspace_id}/chunking-services/{chunking_service_id}"
    )


@router.delete("/{workspace_id}/chunking-services/{chunking_service_id}", status_code=204)
async def delete_chunking_service(workspace_id: str, chunking_service_id: str) -> None:
    raise NotImplementedApiError(
        f"DELETE /api/v1/workspaces/{workspace_id}/chunking-services/{chunking_service_id}"
    )


@router.get("/{workspace_id}/embedding-services", response_model=list[EmbeddingServiceRecord])
async def list_embedding_services(workspace_id: str) -> list[EmbeddingServiceRecord]:
    raise NotImplementedApiError(f"GET /api/v1/workspaces/{workspace_id}/embedding-services")


@router.post(
    "/{workspace_id}/embedding-services",
    response_model=EmbeddingServiceRecord,
    status_code=201,
)
async def create_embedding_service(
    workspace_id: str, _body: CreateEmbeddingServiceInput
) -> EmbeddingServiceRecord:
    raise NotImplementedApiError(f"POST /api/v1/workspaces/{workspace_id}/embedding-services")


@router.get(
    "/{workspace_id}/embedding-services/{embedding_service_id}",
    response_model=EmbeddingServiceRecord,
)
async def get_embedding_service(
    workspace_id: str, embedding_service_id: str
) -> EmbeddingServiceRecord:
    raise NotImplementedApiError(
        f"GET /api/v1/workspaces/{workspace_id}/embedding-services/{embedding_service_id}"
    )


@router.put(
    "/{workspace_id}/embedding-services/{embedding_service_id}",
    response_model=EmbeddingServiceRecord,
)
async def update_embedding_service(
    workspace_id: str,
    embedding_service_id: str,
    _body: UpdateEmbeddingServiceInput,
) -> EmbeddingServiceRecord:
    raise NotImplementedApiError(
        f"PUT /api/v1/workspaces/{workspace_id}/embedding-services/{embedding_service_id}"
    )


@router.delete("/{workspace_id}/embedding-services/{embedding_service_id}", status_code=204)
async def delete_embedding_service(workspace_id: str, embedding_service_id: str) -> None:
    raise NotImplementedApiError(
        f"DELETE /api/v1/workspaces/{workspace_id}/embedding-services/{embedding_service_id}"
    )


@router.get("/{workspace_id}/reranking-services", response_model=list[RerankingServiceRecord])
async def list_reranking_services(workspace_id: str) -> list[RerankingServiceRecord]:
    raise NotImplementedApiError(f"GET /api/v1/workspaces/{workspace_id}/reranking-services")


@router.post(
    "/{workspace_id}/reranking-services",
    response_model=RerankingServiceRecord,
    status_code=201,
)
async def create_reranking_service(
    workspace_id: str, _body: CreateRerankingServiceInput
) -> RerankingServiceRecord:
    raise NotImplementedApiError(f"POST /api/v1/workspaces/{workspace_id}/reranking-services")


@router.get(
    "/{workspace_id}/reranking-services/{reranking_service_id}",
    response_model=RerankingServiceRecord,
)
async def get_reranking_service(
    workspace_id: str, reranking_service_id: str
) -> RerankingServiceRecord:
    raise NotImplementedApiError(
        f"GET /api/v1/workspaces/{workspace_id}/reranking-services/{reranking_service_id}"
    )


@router.put(
    "/{workspace_id}/reranking-services/{reranking_service_id}",
    response_model=RerankingServiceRecord,
)
async def update_reranking_service(
    workspace_id: str,
    reranking_service_id: str,
    _body: UpdateRerankingServiceInput,
) -> RerankingServiceRecord:
    raise NotImplementedApiError(
        f"PUT /api/v1/workspaces/{workspace_id}/reranking-services/{reranking_service_id}"
    )


@router.delete("/{workspace_id}/reranking-services/{reranking_service_id}", status_code=204)
async def delete_reranking_service(workspace_id: str, reranking_service_id: str) -> None:
    raise NotImplementedApiError(
        f"DELETE /api/v1/workspaces/{workspace_id}/reranking-services/{reranking_service_id}"
    )
