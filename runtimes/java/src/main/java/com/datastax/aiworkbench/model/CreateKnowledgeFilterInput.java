package com.datastax.aiworkbench.model;

import jakarta.validation.constraints.NotBlank;
import java.util.Map;

/** Request body for creating a saved Knowledge Base filter. */
public record CreateKnowledgeFilterInput(
    String uid,
    @NotBlank String name,
    String description,
    Map<String, Object> filter
) {}
