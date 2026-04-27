package com.datastax.aiworkbench.model;

import jakarta.validation.constraints.NotBlank;

/** Request body for creating a chunking service. */
public record CreateChunkingServiceInput(
    String uid,
    @NotBlank String name,
    String description,
    ServiceStatus status,
    @NotBlank String engine,
    String engineVersion,
    String strategy,
    Integer maxChunkSize,
    Integer minChunkSize,
    String chunkUnit,
    Integer overlapSize,
    String overlapUnit,
    Boolean preserveStructure,
    String language,
    Integer maxPayloadSizeKb,
    Boolean enableOcr,
    Boolean extractTables,
    Boolean extractFigures,
    String readingOrder,
    String endpointBaseUrl,
    String endpointPath,
    Integer requestTimeoutMs,
    AuthType authType,
    String credentialRef
) {}
