"""FastAPI app factory for the Python workbench runtime.

Exposes the same ``/api/v1/*`` surface as the TypeScript runtime so the
UI (or any other client) can point at either via ``BACKEND_URL``.

Layout:
  - Routers under ``workbench.routes.*`` mounted at ``/api/v1/...``.
  - Request-ID middleware mirrors the TS runtime's ``X-Request-Id``
    behavior.
  - Canonical error envelope ``{"error": {...}}`` produced by the
    :class:`ApiError` exception handler.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from workbench import __version__
from workbench.errors import ApiError
from workbench.routes import catalogs, documents, vector_stores, workspaces

REQUEST_ID_HEADER = "X-Request-Id"


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Echo a client-supplied request ID, or generate a new ULID-ish.

    Matches the TS runtime's contract: every response carries
    ``X-Request-Id``, and handlers can read it via ``request.state.request_id``
    for inclusion in error payloads.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


def _error_envelope(code: str, message: str, request_id: str) -> dict[str, object]:
    return {"error": {"code": code, "message": message, "requestId": request_id}}


def create_app() -> FastAPI:
    app = FastAPI(
        title="AI Workbench (Python runtime)",
        description=(
            "One of N language 'green boxes' that expose the AI Workbench "
            "HTTP API. The UI targets this service via BACKEND_URL."
        ),
        version=__version__,
        openapi_url="/api/v1/openapi.json",
        docs_url="/docs",
    )

    app.add_middleware(RequestIdMiddleware)

    # --- Operational routes (unversioned, match TS runtime) ---

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz() -> dict[str, str]:
        # Phase 1a.2+ will check astra connectivity here.
        return {"status": "ready"}

    @app.get("/version")
    async def version() -> dict[str, str]:
        return {"version": __version__, "runtime": "python"}

    @app.get("/")
    async def root() -> dict[str, str]:
        return {
            "name": "ai-workbench-runtime",
            "runtime": "python",
            "version": __version__,
            "docs": "/docs",
        }

    # --- API routes ---

    app.include_router(workspaces.router, prefix="/api/v1/workspaces", tags=["workspaces"])
    app.include_router(catalogs.router, prefix="/api/v1/workspaces", tags=["catalogs"])
    app.include_router(
        vector_stores.router,
        prefix="/api/v1/workspaces",
        tags=["vector-stores"],
    )
    app.include_router(documents.router, prefix="/api/v1/workspaces", tags=["documents"])

    # --- Error handling ---

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status,
            content=_error_envelope(
                exc.code,
                str(exc),
                getattr(request.state, "request_id", "unknown"),
            ),
        )

    return app


# Module-level app for `uvicorn workbench.app:app`.
app = create_app()
