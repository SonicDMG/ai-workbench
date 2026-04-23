package com.datastax.aiworkbench.model;

import java.util.Map;

/** Metadata about an ingested document. */
public record DocumentRecord(
    String workspace,
    String catalogUid,
    String documentUid,
    String sourceDocId,
    String sourceFilename,
    String fileType,
    Long fileSize,
    String md5Hash,
    Long chunkTotal,
    String ingestedAt,
    String updatedAt,
    DocumentStatus status,
    String errorMessage,
    Map<String, String> metadata
) {}
