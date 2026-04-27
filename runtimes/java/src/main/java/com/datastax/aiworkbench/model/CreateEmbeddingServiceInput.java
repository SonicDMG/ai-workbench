package com.datastax.aiworkbench.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** Request body for creating an embedding service. */
public record CreateEmbeddingServiceInput(
    String uid,
    @NotBlank String name,
    String description,
    ServiceStatus status,
    @NotBlank String provider,
    @NotBlank String modelName,
    @NotNull Integer embeddingDimension,
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
