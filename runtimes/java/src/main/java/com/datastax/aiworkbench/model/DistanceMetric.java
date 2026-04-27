package com.datastax.aiworkbench.model;

/** Distance metric used by embedding services and vector collections. */
public enum DistanceMetric {
    cosine,
    dot,
    euclidean;
}
