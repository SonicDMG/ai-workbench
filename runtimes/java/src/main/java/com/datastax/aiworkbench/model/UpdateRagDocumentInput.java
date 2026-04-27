package com.datastax.aiworkbench.model;

import java.util.Map;

/** Request body for updating Knowledge Base document metadata. */
public record UpdateRagDocumentInput(
    String sourceDocId,
    String sourceFilename,
    String fileType,
    Long fileSize,
    String contentHash,
    Long chunkTotal,
    DocumentStatus status,
    String errorMessage,
    String ingestedAt,
    Map<String, String> metadata
) {}
