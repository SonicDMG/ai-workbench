package com.datastax.aiworkbench.error;

/**
 * 501 — scaffold placeholder. Every unimplemented route throws this so
 * the canonical error envelope is consistent and conformance tests can
 * tell "not yet built" apart from "real failure."
 */
public class NotImplementedApiError extends ApiError {
    public NotImplementedApiError(String what) {
        super(
            "not_implemented",
            what + " is not yet implemented in the Java runtime",
            501
        );
    }
}
