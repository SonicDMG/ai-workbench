"""workbench_astra_client — Python client for AI Workbench Astra tables.

Public surface:

    from workbench_astra_client import WorkbenchAstraClient

    client = WorkbenchAstraClient(
        endpoint="http://localhost:4010",
        token="test-token",
        keyspace="workbench",
    )
    ws = client.workspaces.create(name="prod", kind="astra")

See ``clients/conformance/scenarios.md`` for the full operation set.
"""

from workbench_astra_client.client import WorkbenchAstraClient
from workbench_astra_client.types import (
    CatalogRecord,
    DocumentRecord,
    EmbeddingConfig,
    LexicalConfig,
    RerankingConfig,
    VectorStoreRecord,
    WorkspaceRecord,
)

__all__ = [
    "CatalogRecord",
    "DocumentRecord",
    "EmbeddingConfig",
    "LexicalConfig",
    "RerankingConfig",
    "VectorStoreRecord",
    "WorkbenchAstraClient",
    "WorkspaceRecord",
]

__version__ = "0.0.0"
