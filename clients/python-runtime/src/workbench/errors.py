"""HTTP error mapping for the runtime.

Routes raise :class:`ApiError` (or one of its subclasses); the app-level
exception handler converts them to the canonical error envelope
``{"error": {"code", "message", "requestId"}}`` — same shape the TS
runtime emits.
"""

from __future__ import annotations


class ApiError(Exception):
    """Base for HTTP errors with a stable ``code`` and status."""

    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class NotFoundError(ApiError):
    def __init__(self, resource: str, uid: str) -> None:
        super().__init__(
            code=f"{resource}_not_found",
            message=f"{resource} '{uid}' not found",
            status=404,
        )


class ConflictError(ApiError):
    def __init__(self, message: str) -> None:
        super().__init__(code="conflict", message=message, status=409)


class UnavailableError(ApiError):
    def __init__(self, message: str) -> None:
        super().__init__(
            code="control_plane_unavailable",
            message=message,
            status=503,
        )


class NotImplementedApiError(ApiError):
    """Raised by scaffolded handlers until a real implementation lands."""

    def __init__(self, what: str) -> None:
        super().__init__(
            code="not_implemented",
            message=f"{what} is not yet implemented in the Python runtime",
            status=501,
        )
