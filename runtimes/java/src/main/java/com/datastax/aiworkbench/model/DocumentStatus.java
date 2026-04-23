package com.datastax.aiworkbench.model;

/** Lifecycle state of an ingested document. */
public enum DocumentStatus {
    pending,
    chunking,
    embedding,
    writing,
    ready,
    failed;
}
