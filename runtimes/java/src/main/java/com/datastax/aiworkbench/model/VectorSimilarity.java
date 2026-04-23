package com.datastax.aiworkbench.model;

/** Distance function used for vector similarity search. */
public enum VectorSimilarity {
    cosine,
    dot,
    euclidean;
}
