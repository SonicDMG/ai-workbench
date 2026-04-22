"""Pytest fixtures for the Python conformance suite.

Fixtures:

  mock_url       — base URL for the running mock-astra server. Reads from
                   the ``CONFORMANCE_MOCK_URL`` env var, defaulting to
                   ``http://127.0.0.1:4010``. The mock is NOT started by
                   pytest — run ``npm run conformance:mock`` in a separate
                   terminal from the repo root first.

  client         — WorkbenchAstraClient pointed at the mock.
                   Yielded inside a context manager; reset is triggered
                   before every test via the ``reset_mock`` fixture below.

  reset_mock     — Autouse. Issues ``POST /_reset`` before each test so
                   captured requests never leak across cases.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import httpx
import pytest

from workbench_astra_client import WorkbenchAstraClient


@pytest.fixture(scope="session")
def mock_url() -> str:
    return os.environ.get("CONFORMANCE_MOCK_URL", "http://127.0.0.1:4010")


@pytest.fixture(scope="session", autouse=True)
def _require_mock_alive(mock_url: str) -> None:
    """Fail fast with a clear message if the mock isn't running."""
    try:
        httpx.get(f"{mock_url}/_health", timeout=1.0).raise_for_status()
    except (httpx.HTTPError, httpx.RequestError) as exc:
        pytest.skip(
            "mock-astra is not running at "
            f"{mock_url}. From the repo root: `npm run conformance:mock`."
            f" (underlying error: {exc})"
        )


@pytest.fixture(autouse=True)
def reset_mock(mock_url: str) -> None:
    httpx.post(f"{mock_url}/_reset", timeout=2.0).raise_for_status()


@pytest.fixture
def client(mock_url: str) -> Iterator[WorkbenchAstraClient]:
    with WorkbenchAstraClient(
        endpoint=mock_url,
        token="test-token",
        keyspace="workbench",
    ) as c:
        yield c


@pytest.fixture
def captured(mock_url: str) -> object:
    """Factory: call as ``captured()`` at the end of a test to fetch the
    mock's captured request log."""

    def _fetch() -> list[dict[str, object]]:
        response = httpx.get(f"{mock_url}/_captured", timeout=2.0)
        response.raise_for_status()
        return response.json()

    return _fetch
