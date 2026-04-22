"""Runtime configuration resolved from environment variables.

Mirrors the shape of the TS runtime's config where applicable. The UI
discovers this runtime via ``BACKEND_URL``; no config is needed on the
UI side beyond that URL.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AstraConfig:
    """Connection to the Astra endpoint the runtime targets."""

    endpoint: str
    token: str
    keyspace: str


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    host: str
    port: int
    astra: AstraConfig | None
    log_level: str


def load_config() -> RuntimeConfig:
    """Resolve runtime config from environment variables.

    Recognized env vars:
      - ``WORKBENCH_HOST`` (default ``0.0.0.0``)
      - ``WORKBENCH_PORT`` (default ``8080``)
      - ``WORKBENCH_LOG_LEVEL`` (default ``info``)
      - ``ASTRA_DB_API_ENDPOINT`` (optional — when unset, Astra calls
        raise until configured)
      - ``ASTRA_DB_APPLICATION_TOKEN`` (optional, paired with endpoint)
      - ``ASTRA_DB_KEYSPACE`` (default ``workbench``)
    """
    astra: AstraConfig | None = None
    endpoint = os.environ.get("ASTRA_DB_API_ENDPOINT")
    token = os.environ.get("ASTRA_DB_APPLICATION_TOKEN")
    if endpoint and token:
        astra = AstraConfig(
            endpoint=endpoint,
            token=token,
            keyspace=os.environ.get("ASTRA_DB_KEYSPACE", "workbench"),
        )

    return RuntimeConfig(
        host=os.environ.get("WORKBENCH_HOST", "0.0.0.0"),
        port=int(os.environ.get("WORKBENCH_PORT", "8080")),
        astra=astra,
        log_level=os.environ.get("WORKBENCH_LOG_LEVEL", "info").lower(),
    )
