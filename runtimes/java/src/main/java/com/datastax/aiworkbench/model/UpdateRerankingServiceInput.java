package com.datastax.aiworkbench.model;

import java.util.List;

/** Request body for updating a reranking service. */
public record UpdateRerankingServiceInput(
    String name,
    String description,
    ServiceStatus status,
    String provider,
    String engine,
    String modelName,
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
