package com.datastax.aiworkbench.error;

/** 404 — a resource doesn't exist in its parent scope. */
public class NotFoundError extends ApiError {
    public NotFoundError(String resource, String uid) {
        super(resource + "_not_found", resource + " '" + uid + "' not found", 404);
    }
}
