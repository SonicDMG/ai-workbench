package com.datastax.aiworkbench.model;

import java.util.List;
import java.util.Map;

/** Request body for Knowledge Base vector/hybrid search. */
public record SearchInput(
    List<Double> vector,
    String text,
    Integer topK,
    Map<String, Object> filter,
    Boolean hybrid,
    Boolean rerank
) {}
