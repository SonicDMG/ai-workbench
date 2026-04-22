"""Operational-route tests — no Astra needed, no scaffolding in the way.

These assert the app's basic contract works end-to-end in-process
(request-id middleware, health, version, root banner, OpenAPI doc).
"""

from __future__ import annotations

import httpx


async def test_healthz_returns_ok(client: httpx.AsyncClient) -> None:
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_readyz_returns_ready(client: httpx.AsyncClient) -> None:
    response = await client.get("/readyz")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


async def test_version_includes_runtime_tag(client: httpx.AsyncClient) -> None:
    response = await client.get("/version")
    assert response.status_code == 200
    body = response.json()
    assert body["runtime"] == "python"
    assert "version" in body


async def test_root_banner(client: httpx.AsyncClient) -> None:
    response = await client.get("/")
    body = response.json()
    assert body["name"] == "ai-workbench-runtime"
    assert body["runtime"] == "python"


async def test_request_id_is_echoed(client: httpx.AsyncClient) -> None:
    response = await client.get("/healthz", headers={"X-Request-Id": "test-rid-123"})
    assert response.headers["x-request-id"] == "test-rid-123"


async def test_request_id_is_generated_when_absent(client: httpx.AsyncClient) -> None:
    response = await client.get("/healthz")
    assert response.headers.get("x-request-id")


async def test_openapi_doc_served(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/openapi.json")
    assert response.status_code == 200
    spec = response.json()
    assert spec["info"]["title"] == "AI Workbench (Python runtime)"
    # Every scaffold route appears in the doc.
    paths = spec["paths"]
    assert "/api/v1/workspaces" in paths
    assert "/api/v1/workspaces/{workspace_id}" in paths
    assert "/api/v1/workspaces/{workspace_id}/catalogs" in paths
    assert "/api/v1/workspaces/{workspace_id}/vector-stores" in paths
