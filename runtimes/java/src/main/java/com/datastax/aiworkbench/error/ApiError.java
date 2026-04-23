package com.datastax.aiworkbench.error;

/**
 * HTTP error with a stable {@code code} and status.
 *
 * <p>Controllers throw this (or one of its subclasses); the app-level
 * {@link GlobalExceptionHandler} converts it to the canonical error
 * envelope {@code {"error": {"code", "message", "requestId"}}} — same
 * shape the TypeScript runtime emits.
 */
public class ApiError extends RuntimeException {

    private final String code;
    private final int status;

    public ApiError(String code, String message, int status) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String code() {
        return code;
    }

    public int status() {
        return status;
    }
}
