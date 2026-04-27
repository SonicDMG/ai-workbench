package com.datastax.aiworkbench.model;

import java.util.Map;

/** Lexical / BM25 configuration for a knowledge base. */
public record LexicalConfig(boolean enabled, String analyzer, Map<String, String> options) {}
