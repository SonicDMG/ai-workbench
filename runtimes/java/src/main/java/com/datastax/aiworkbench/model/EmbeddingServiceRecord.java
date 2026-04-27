package com.datastax.aiworkbench.model;

import java.util.List;

/** An embedding executor descriptor. */
public record EmbeddingServiceRecord(
    String workspaceId,
    String embeddingServiceId,
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
    String credentialRef,
    String createdAt,
    String updatedAt
) {}
