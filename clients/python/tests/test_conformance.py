"""Python conformance tests.

Runs each scenario from ``clients/conformance/scenarios.md`` against the
mock-astra server. Tests are marked ``xfail`` where the Python client
still raises ``NotImplementedError``; flip them to real assertions as
implementations land.

Once ``clients/conformance/fixtures/<scenario>.json`` files exist (they
ship with PR-1a.2 alongside the canonical TS client), this suite will
also diff the captured HTTP payloads against those fixtures.
"""

from __future__ import annotations

import pytest

from workbench_astra_client import WorkbenchAstraClient


@pytest.mark.xfail(
    raises=NotImplementedError,
    reason="Scaffold: control-plane implementations land in follow-up PRs.",
    strict=True,
)
def test_scenario_workspace_crud_basic(client: WorkbenchAstraClient) -> None:
    # Scenario 1 — workspace-crud-basic
    ws = client.workspaces.create(name="prod", kind="astra")
    all_ws = client.workspaces.list()
    fetched = client.workspaces.get(ws.uid)
    updated = client.workspaces.update(ws.uid, name="production")
    deleted = client.workspaces.delete(ws.uid)

    assert ws.uid
    assert fetched is not None and fetched.uid == ws.uid
    assert updated.name == "production"
    assert deleted
    assert any(w.uid == ws.uid for w in all_ws)


@pytest.mark.xfail(
    raises=NotImplementedError,
    reason="Scaffold: control-plane implementations land in follow-up PRs.",
    strict=True,
)
def test_scenario_catalog_under_workspace(client: WorkbenchAstraClient) -> None:
    # Scenario 2 — catalog-under-workspace
    ws = client.workspaces.create(name="w", kind="astra")
    c1 = client.catalogs.create(workspace=ws.uid, name="c1")
    c2 = client.catalogs.create(workspace=ws.uid, name="c2")
    catalogs = client.catalogs.list(workspace=ws.uid)
    client.catalogs.delete(workspace=ws.uid, uid=c1.uid)

    assert {c.uid for c in catalogs} == {c1.uid, c2.uid}


@pytest.mark.xfail(
    raises=NotImplementedError,
    reason="Scaffold: control-plane implementations land in follow-up PRs.",
    strict=True,
)
def test_scenario_vector_store_definition(
    client: WorkbenchAstraClient,
) -> None:
    # Scenario 3 — vector-store-definition
    from workbench_astra_client import EmbeddingConfig

    ws = client.workspaces.create(name="w", kind="astra")
    vs = client.vector_stores.create(
        workspace=ws.uid,
        name="vs",
        vector_dimension=1536,
        embedding=EmbeddingConfig(
            provider="openai",
            model="text-embedding-3-small",
            endpoint=None,
            dimension=1536,
            secret_ref="env:OPENAI_API_KEY",
        ),
    )
    fetched = client.vector_stores.get(workspace=ws.uid, uid=vs.uid)

    assert fetched is not None and fetched.uid == vs.uid


def test_mock_capture_log_is_reset_between_tests(
    client: WorkbenchAstraClient,
    captured,  # type: ignore[no-untyped-def]  # conftest factory
) -> None:
    """Sanity check for the test harness itself: the ``reset_mock``
    fixture wipes captured requests before each test, so this one
    starts from an empty log.
    """
    assert captured() == []
