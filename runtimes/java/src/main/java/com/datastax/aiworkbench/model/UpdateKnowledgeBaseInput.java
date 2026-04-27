package com.datastax.aiworkbench.model;

/** Request body for {@code PUT /api/v1/workspaces/{workspaceId}/knowledge-bases/{kbId}}. */
public record UpdateKnowledgeBaseInput(
    String name,
    String description,
    KnowledgeBaseStatus status,
    String embeddingServiceId,
    String chunkingServiceId,
    String rerankingServiceId,
    String language,
    LexicalConfig lexical
) {}
