package com.datastax.aiworkbench.model;

/** Shared endpoint details for execution services. */
public record ServiceEndpointConfig(
    String endpointBaseUrl,
    String endpointPath,
    Integer requestTimeoutMs,
    AuthType authType,
    String credentialRef
) {}
