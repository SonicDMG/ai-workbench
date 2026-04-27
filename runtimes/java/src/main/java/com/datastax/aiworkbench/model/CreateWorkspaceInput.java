package com.datastax.aiworkbench.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Map;

/** Request body for {@code POST /api/v1/workspaces}. */
public record CreateWorkspaceInput(
    String uid,
    @NotBlank String name,
    String url,
    @NotNull WorkspaceKind kind,
    Map<String, String> credentials,
    String keyspace
) {}
