package com.datastax.aiworkbench.model;

import java.util.Map;

/**
 * Request body for {@code PUT /api/v1/workspaces/{uid}}.
 *
 * <p>{@code kind} is intentionally absent — a workspace's backend is
 * immutable after creation. The TS runtime rejects PUT bodies containing
 * {@code kind}; Java should do the same (Jackson's
 * {@code FAIL_ON_UNKNOWN_PROPERTIES} is enabled by default).
 */
public record UpdateWorkspaceInput(
    String name,
    String url,
    Map<String, String> credentials,
    String namespace
) {}
