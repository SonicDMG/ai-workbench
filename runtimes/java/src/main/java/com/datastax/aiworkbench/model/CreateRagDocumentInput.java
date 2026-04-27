package com.datastax.aiworkbench.model;

import java.util.Map;

/** Request body for creating Knowledge Base document metadata. */
public record CreateRagDocumentInput(
    String uid,
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
