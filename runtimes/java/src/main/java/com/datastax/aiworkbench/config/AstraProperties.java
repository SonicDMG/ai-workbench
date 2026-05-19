package com.datastax.aiworkbench.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Astra Data API connection settings, bound from {@code astra.*} keys in
 * {@code application.yml} (each falling back to a matching env var:
 * {@code ASTRA_DB_API_ENDPOINT}, {@code ASTRA_DB_APPLICATION_TOKEN},
 * {@code ASTRA_DB_KEYSPACE}).
 *
 * <p>Fields are nullable / blank-permissible — the runtime boots without
 * Astra creds (every controller still returns 501 via
 * {@code NotImplementedApiError}). The {@link AstraClientConfiguration}
 * beans only materialise when both {@code endpoint} and {@code token}
 * are set.
 */
@ConfigurationProperties("astra")
public record AstraProperties(String endpoint, String token, String keyspace) {}
