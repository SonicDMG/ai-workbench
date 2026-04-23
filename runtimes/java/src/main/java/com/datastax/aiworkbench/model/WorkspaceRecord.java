package com.datastax.aiworkbench.model;

import java.util.Map;

/**
 * A workspace — the top-level tenant boundary.
 *
 * <p>Mirrors {@code WorkspaceRecord} in the TypeScript runtime
 * ({@code runtimes/typescript/src/control-plane/types.ts}). Keep the
 * field names identical — they flow to the wire as-is.
 */
public record WorkspaceRecord(
    String uid,
    String name,
    String url,
    WorkspaceKind kind,
    /** Map of credential name → SecretRef pointer ({@code <provider>:<path>}). */
    Map<String, String> credentialsRef,
    String keyspace,
    String createdAt,
    String updatedAt
) {}
