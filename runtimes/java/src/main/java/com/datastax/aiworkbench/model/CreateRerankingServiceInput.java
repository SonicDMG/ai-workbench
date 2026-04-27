package com.datastax.aiworkbench.model;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/** Request body for creating a reranking service. */
public record CreateRerankingServiceInput(
    String uid,
    @NotBlank String name,
    String description,
    ServiceStatus status,
    @NotBlank String provider,
    String engine,
    @NotBlank String modelName,
    String modelVersion,
    Integer maxCandidates,
    String scoringStrategy,
    Boolean scoreNormalized,
    Boolean returnScores,
    Integer maxBatchSize,
    List<String> supportedLanguages,
    List<String> supportedContent,
    String endpointBaseUrl,
    String endpointPath,
    Integer requestTimeoutMs,
    AuthType authType,
    String credentialRef
) {}
