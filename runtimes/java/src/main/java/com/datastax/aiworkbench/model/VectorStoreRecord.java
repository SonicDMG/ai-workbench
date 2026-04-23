package com.datastax.aiworkbench.model;

import java.util.Map;

/** Descriptor row for a vector store. The underlying Data API Collection lives elsewhere. */
public record VectorStoreRecord(
    String workspace,
    String uid,
    String name,
    int vectorDimension,
    VectorSimilarity vectorSimilarity,
    EmbeddingConfig embedding,
    LexicalConfig lexical,
    RerankingConfig reranking,
    String createdAt,
    String updatedAt
) {
    public record EmbeddingConfig(
        String provider,
        String model,
        String endpoint,
        int dimension,
        String secretRef
    ) {}

    public record LexicalConfig(boolean enabled, String analyzer, Map<String, String> options) {}

    public record RerankingConfig(
        boolean enabled,
        String provider,
        String model,
        String endpoint,
        String secretRef
    ) {}
}
