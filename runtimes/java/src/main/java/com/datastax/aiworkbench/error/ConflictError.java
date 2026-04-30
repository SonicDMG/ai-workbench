package com.datastax.aiworkbench.error;

/** 409 — a ID collision on create. */
public class ConflictError extends ApiError {
    public ConflictError(String message) {
        super("conflict", message, 409);
    }
}
