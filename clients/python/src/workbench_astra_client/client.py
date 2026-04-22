"""Top-level entry point for the Workbench Astra client.

Usage::

    from workbench_astra_client import WorkbenchAstraClient

    client = WorkbenchAstraClient(
        endpoint="https://...apps.astra.datastax.com",
        token="AstraCS:...",
        keyspace="workbench",
    )
    ws = client.workspaces.create(name="prod", kind="astra")
    catalog = client.catalogs.create(workspace=ws.uid, name="support")

For conformance testing, point the client at the mock:

    client = WorkbenchAstraClient(
        endpoint="http://127.0.0.1:4010",
        token="test-token",
        keyspace="workbench",
    )
"""

from __future__ import annotations

from workbench_astra_client._http import AstraEndpoint, AstraHttp
from workbench_astra_client.control_plane import (
    Catalogs,
    Documents,
    VectorStores,
    Workspaces,
)
from workbench_astra_client.data_plane import Collections


class WorkbenchAstraClient:
    """Facade over control-plane and data-plane modules.

    Do not subclass — compose instead. This class exists to collect the
    resource modules under a single configuration.
    """

    def __init__(
        self,
        *,
        endpoint: str,
        token: str,
        keyspace: str,
        timeout: float = 10.0,
    ) -> None:
        self._http = AstraHttp(
            AstraEndpoint(endpoint=endpoint, token=token, keyspace=keyspace),
            timeout=timeout,
        )
        self.workspaces = Workspaces(self._http)
        self.catalogs = Catalogs(self._http)
        self.vector_stores = VectorStores(self._http)
        self.documents = Documents(self._http)
        self.collections = Collections(self._http)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "WorkbenchAstraClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
