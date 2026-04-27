package com.datastax.aiworkbench.model;

import java.util.List;
import java.util.Map;

/** Vector/text record for Knowledge Base upsert. */
public record VectorRecord(
    String id,
    List<Double> vector,
    String text,
    Map<String, Object> payload
) {}
