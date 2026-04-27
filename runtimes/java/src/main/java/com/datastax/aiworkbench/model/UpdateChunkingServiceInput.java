package com.datastax.aiworkbench.model;

/** Request body for updating a chunking service. */
public record UpdateChunkingServiceInput(
    String name,
    String description,
    ServiceStatus status,
    String engine,
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
