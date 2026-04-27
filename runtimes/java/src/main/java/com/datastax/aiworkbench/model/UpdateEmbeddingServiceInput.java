package com.datastax.aiworkbench.model;

import java.util.List;

/** Request body for updating an embedding service. */
public record UpdateEmbeddingServiceInput(
    String name,
    String description,
    ServiceStatus status,
    String provider,
    String modelName,
    Integer embeddingDimension,
    DistanceMetric distanceMetric,
    Integer maxBatchSize,
    Integer maxInputTokens,
    List<String> supportedLanguages,
    List<String> supportedContent,
    String endpointBaseUrl,
    String endpointPath,
    Integer requestTimeoutMs,
    AuthType authType,
    String credentialRef
) {}
