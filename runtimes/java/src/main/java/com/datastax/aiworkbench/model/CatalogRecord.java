package com.datastax.aiworkbench.model;

/** A named document collection within a workspace. */
public record CatalogRecord(
    String workspace,
    String uid,
    String name,
    String description,
    String vectorStore,
    String createdAt,
    String updatedAt
) {}
