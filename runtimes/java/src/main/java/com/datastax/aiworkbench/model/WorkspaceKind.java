package com.datastax.aiworkbench.model;

/**
 * Backend that a workspace's data plane targets. Immutable after
 * creation — the TypeScript runtime rejects {@code kind} in PUT bodies.
 */
public enum WorkspaceKind {
    astra,
    hcd,
    openrag,
    mock;
}
