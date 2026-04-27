package com.datastax.aiworkbench.model;

import jakarta.validation.constraints.NotBlank;

/** Request body for {@code POST /api/v1/workspaces/{workspaceId}/knowledge-bases}. */
public record CreateKnowledgeBaseInput(
    String uid,
    @NotBlank String name,
    String description,
    KnowledgeBaseStatus status,
    @NotBlank String embeddingServiceId,
    @NotBlank String chunkingServiceId,
    String rerankingServiceId,
    String language,
    String vectorCollection,
    LexicalConfig lexical
) {}
