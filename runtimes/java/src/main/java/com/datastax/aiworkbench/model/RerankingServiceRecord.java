package com.datastax.aiworkbench.model;

import java.util.List;

/** A reranking executor descriptor. */
public record RerankingServiceRecord(
    String workspaceId,
    String rerankingServiceId,
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
    String credentialRef,
    String createdAt,
    String updatedAt
) {}
