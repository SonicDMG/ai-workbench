"""AI Workbench — Python runtime.

One of N language "green boxes" that expose the workbench HTTP API at
``/api/v1/*`` and speak Astra's Data API internally via astrapy.

Runs as a standalone HTTP server (``python -m workbench`` or
``uvicorn workbench.app:app``). The UI points at it via ``BACKEND_URL``.
"""

__version__ = "0.0.0"
