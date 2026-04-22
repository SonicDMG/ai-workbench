"""Pytest fixtures for the Python green-box runtime.

Fixtures:

  app      — FastAPI app with Astra env vars pointed at the mock-astra
             server (started separately via `npm run conformance:mock`).
  client   — httpx.AsyncClient bound to ``app`` via ASGI transport. No
             sockets — tests exercise the app in-process.
  mock_url — base URL of mock-astra, read from ``CONFORMANCE_MOCK_URL``
             (default ``http://127.0.0.1:4010``).
  reset_mock — autouse; wipes the mock's request log before each test.

The green box is exercised as a black box: tests hit its HTTP API and
assert on HTTP responses, not on what it sends to Astra. The mock-astra
request log is still available via the ``mock_captured`` fixture for
debugging.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable

import httpx
import pytest
from fastapi import FastAPI

from workbench.app import create_app


@pytest.fixture(scope="session")
def mock_url() -> str:
    return os.environ.get("CONFORMANCE_MOCK_URL", "http://127.0.0.1:4010")


@pytest.fixture(scope="session", autouse=True)
def _require_mock_alive(mock_url: str) -> None:
    try:
        httpx.get(f"{mock_url}/_health", timeout=1.0).raise_for_status()
    except (httpx.HTTPError, httpx.RequestError) as exc:
        pytest.skip(
            f"mock-astra is not running at {mock_url}. "
            f"From the repo root: `npm run conformance:mock`. "
            f"(underlying: {exc})"
        )


@pytest.fixture(autouse=True)
def reset_mock(mock_url: str) -> None:
    httpx.post(f"{mock_url}/_reset", timeout=2.0).raise_for_status()


@pytest.fixture
def app(mock_url: str, monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    monkeypatch.setenv("ASTRA_DB_API_ENDPOINT", mock_url)
    monkeypatch.setenv("ASTRA_DB_APPLICATION_TOKEN", "test-token")
    monkeypatch.setenv("ASTRA_DB_KEYSPACE", "workbench")
    return create_app()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.fixture
def mock_captured(mock_url: str) -> Callable[[], list[dict[str, object]]]:
    """Returns a callable that fetches the mock's captured Astra-bound
    requests. Useful for debugging, not for conformance assertions."""

    def _fetch() -> list[dict[str, object]]:
        response = httpx.get(f"{mock_url}/_captured", timeout=2.0)
        response.raise_for_status()
        return response.json()

    return _fetch
