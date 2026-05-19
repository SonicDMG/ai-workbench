package com.datastax.aiworkbench.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.datastax.astra.client.DataAPIClient;
import com.datastax.astra.client.databases.Database;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.TestPropertySource;

/**
 * Confirms the {@code DataAPIClient} / {@code Database} beans are
 * registered only when Astra credentials are present and non-blank.
 *
 * <p>The runtime must boot in both modes: stubs-only conformance tests
 * (no creds) and credentialed development (full client wired). The
 * application.yml binds empty strings when the env vars are unset, so a
 * naive {@code @ConditionalOnProperty} would still match — these tests
 * lock in the {@code AstraCredentialsPresentCondition} behavior.
 */
class AstraClientConfigurationTest {

    @Nested
    @SpringBootTest
    class WithoutCredentials {

        @Autowired ApplicationContext ctx;

        @Test
        void astraBeansAreAbsent() {
            assertThat(ctx.getBeansOfType(DataAPIClient.class)).isEmpty();
            assertThat(ctx.getBeansOfType(Database.class)).isEmpty();
        }
    }

    @Nested
    @SpringBootTest
    @TestPropertySource(properties = {
        "astra.endpoint=https://example.apps.astra.datastax.com",
        "astra.token=AstraCS:fake-token-for-test"
    })
    class WithCredentials {

        @Autowired ApplicationContext ctx;

        @Test
        void astraBeansAreRegistered() {
            assertThat(ctx.getBeansOfType(DataAPIClient.class)).hasSize(1);
            assertThat(ctx.getBeansOfType(Database.class)).hasSize(1);
        }
    }
}
