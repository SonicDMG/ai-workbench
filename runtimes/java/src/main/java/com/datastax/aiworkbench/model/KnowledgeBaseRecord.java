package com.datastax.aiworkbench.model;

/** A Knowledge Base, replacing the old catalog/vector-store API surface. */
public record KnowledgeBaseRecord(
    String workspaceId,
    String knowledgeBaseId,
    String name,
    String description,
    KnowledgeBaseStatus status,
    String embeddingServiceId,
    String chunkingServiceId,
    String rerankingServiceId,
    String language,
    String vectorCollection,
    LexicalConfig lexical,
    String createdAt,
    String updatedAt
) {}
