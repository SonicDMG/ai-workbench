"""Conformance tests — blackbox testing the Python green box.

Each scenario in ``conformance/scenarios.md`` is a sequence of
HTTP requests against ``/api/v1/*``. Responses are normalized (UUIDs,
timestamps, request IDs scrubbed) and diffed against fixtures shared
across every language's green box.

Until fixtures exist and routes are implemented, the scenarios are
marked ``xfail(raises=not-implemented, strict=True)``. Flip a scenario
to green by implementing the routes it needs and removing the marker.
"""

from __future__ import annotations

import httpx
import pytest


@pytest.mark.xfail(
    reason="Scaffold: routes return 501 until implementations land.",
    strict=True,
)
async def test_scenario_workspace_crud_basic(client: httpx.AsyncClient) -> None:
    # Scenario 1 — workspace-crud-basic
    created = await client.post(
        "/api/v1/workspaces",
        json={"name": "prod", "kind": "astra"},
    )
    created.raise_for_status()
    uid = created.json()["uid"]

    listed = await client.get("/api/v1/workspaces")
    assert listed.status_code == 200

    fetched = await client.get(f"/api/v1/workspaces/{uid}")
    assert fetched.status_code == 200

    updated = await client.put(f"/api/v1/workspaces/{uid}", json={"name": "production"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "production"

    deleted = await client.delete(f"/api/v1/workspaces/{uid}")
    assert deleted.status_code == 204


@pytest.mark.xfail(
    reason="Scaffold: routes return 501 until implementations land.",
    strict=True,
)
async def test_scenario_catalog_under_workspace(client: httpx.AsyncClient) -> None:
    # Scenario 2 — catalog-under-workspace
    ws = (await client.post("/api/v1/workspaces", json={"name": "w", "kind": "astra"})).json()
    c1 = (await client.post(f"/api/v1/workspaces/{ws['uid']}/catalogs", json={"name": "c1"})).json()
    await client.post(f"/api/v1/workspaces/{ws['uid']}/catalogs", json={"name": "c2"})
    catalogs = await client.get(f"/api/v1/workspaces/{ws['uid']}/catalogs")
    assert catalogs.status_code == 200
    assert len(catalogs.json()) == 2

    deleted = await client.delete(f"/api/v1/workspaces/{ws['uid']}/catalogs/{c1['uid']}")
    assert deleted.status_code == 204


@pytest.mark.xfail(
    reason="Scaffold: routes return 501 until implementations land.",
    strict=True,
)
async def test_scenario_vector_store_definition(client: httpx.AsyncClient) -> None:
    # Scenario 3 — vector-store-definition
    ws = (await client.post("/api/v1/workspaces", json={"name": "w", "kind": "astra"})).json()
    created = await client.post(
        f"/api/v1/workspaces/{ws['uid']}/vector-stores",
        json={
            "name": "vs",
            "vectorDimension": 1536,
            "embedding": {
                "provider": "openai",
                "model": "text-embedding-3-small",
                "endpoint": None,
                "dimension": 1536,
                "secretRef": "env:OPENAI_API_KEY",
            },
        },
    )
    assert created.status_code == 201
    uid = created.json()["uid"]

    fetched = await client.get(f"/api/v1/workspaces/{ws['uid']}/vector-stores/{uid}")
    assert fetched.status_code == 200


async def test_scaffold_returns_501_with_envelope(client: httpx.AsyncClient) -> None:
    """Sanity check on the error-handling plumbing: a scaffold route
    should return 501 with the canonical error envelope shape, not a
    bare FastAPI 500/validation error.
    """
    response = await client.get("/api/v1/workspaces")
    assert response.status_code == 501
    body = response.json()
    assert "error" in body
    assert body["error"]["code"] == "not_implemented"
    assert "requestId" in body["error"]
