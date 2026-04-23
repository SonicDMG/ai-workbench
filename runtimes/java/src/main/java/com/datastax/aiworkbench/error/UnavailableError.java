package com.datastax.aiworkbench.error;

/** 503 — the control plane's backing store is unreachable. */
public class UnavailableError extends ApiError {
    public UnavailableError(String message) {
        super("control_plane_unavailable", message, 503);
    }
}
