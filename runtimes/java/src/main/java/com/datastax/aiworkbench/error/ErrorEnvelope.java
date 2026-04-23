package com.datastax.aiworkbench.error;

/**
 * Canonical error response shape:
 * <pre>{@code
 * { "error": { "code": "...", "message": "...", "requestId": "..." } }
 * }</pre>
 *
 * Matches the TypeScript runtime's envelope so every green box's error
 * responses diff clean under conformance normalization.
 */
public record ErrorEnvelope(Body error) {

    public record Body(String code, String message, String requestId) {}

    public static ErrorEnvelope of(String code, String message, String requestId) {
        return new ErrorEnvelope(new Body(code, message, requestId));
    }
}
