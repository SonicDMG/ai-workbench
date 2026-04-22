"""Shared HTTPX transport for the Workbench Astra client.

Centralizes endpoint/token/keyspace wiring so the control-plane and
data-plane modules don't each reinvent it. Keep this small — the real
work is in the per-resource modules.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True, slots=True)
class AstraEndpoint:
    """Where the client is pointed. For conformance tests this is the
    mock-astra server; for real usage it's a DataStax Astra endpoint.
    """

    endpoint: str
    token: str
    keyspace: str


class AstraHttp:
    """Thin wrapper around httpx.Client that injects the standard
    Astra Data API headers.

    Conformance-critical: the header set emitted here MUST match every
    language port byte-for-byte. If you add a header, add it to every
    other client AND regenerate fixtures.
    """

    def __init__(self, endpoint: AstraEndpoint, *, timeout: float = 10.0) -> None:
        self._endpoint = endpoint
        self._client = httpx.Client(
            base_url=endpoint.endpoint,
            timeout=timeout,
            headers={
                "content-type": "application/json",
                "token": endpoint.token,
            },
        )

    @property
    def keyspace(self) -> str:
        return self._endpoint.keyspace

    def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
    ) -> httpx.Response:
        response = self._client.request(method, path, json=json)
        response.raise_for_status()
        return response

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "AstraHttp":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
