package com.datastax.aiworkbench.model;

import java.util.Map;

/** Request body for updating a saved Knowledge Base filter. */
public record UpdateKnowledgeFilterInput(
    String name,
    String description,
    Map<String, Object> filter
) {}
