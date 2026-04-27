package com.datastax.aiworkbench.model;

import java.util.Map;

/** Metadata about an ingested document under a Knowledge Base. */
public record RagDocumentRecord(
    String workspaceId,
    String knowledgeBaseId,
    String documentId,
    String sourceDocId,
    String sourceFilename,
    String fileType,
    Long fileSize,
    String contentHash,
    Long chunkTotal,
    DocumentStatus status,
    String errorMessage,
    String ingestedAt,
    String updatedAt,
    Map<String, String> metadata
) {}
