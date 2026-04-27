package com.datastax.aiworkbench.model;

import java.util.Map;

/** Request body for Knowledge Base ingest. */
public record IngestInput(Map<String, Object> source, Map<String, String> metadata) {}
