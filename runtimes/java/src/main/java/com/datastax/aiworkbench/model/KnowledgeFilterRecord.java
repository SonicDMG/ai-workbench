package com.datastax.aiworkbench.model;

import java.util.Map;

/** A saved payload filter scoped to one Knowledge Base. */
public record KnowledgeFilterRecord(
    String workspaceId,
    String knowledgeBaseId,
    String knowledgeFilterId,
    String name,
    String description,
    Map<String, Object> filter,
    String createdAt,
    String updatedAt
) {}
