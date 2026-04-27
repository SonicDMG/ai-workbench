package com.datastax.aiworkbench.model;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/** Request body for Knowledge Base record upsert. */
public record UpsertRecordsInput(@NotNull List<VectorRecord> records) {}
