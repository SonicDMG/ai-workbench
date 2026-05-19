package com.datastax.aiworkbench.config;

import com.datastax.astra.client.DataAPIClient;
import com.datastax.astra.client.databases.Database;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.ConfigurationCondition;
import org.springframework.core.type.AnnotatedTypeMetadata;

/**
 * Wires the Astra Data API client. Produces a singleton {@link DataAPIClient}
 * and a {@link Database} bound to the configured endpoint (and optional
 * keyspace) — mirroring the TypeScript runtime's {@code openAstraClient()}
 * lifecycle.
 *
 * <p>Both beans are guarded by {@link AstraCredentialsPresentCondition} so the
 * runtime still boots without Astra credentials (controllers continue to
 * return 501 via {@code NotImplementedApiError}). The application.yml binds
 * empty strings when the env vars are unset, so a presence-only conditional
 * is not enough — the condition rejects blank values too. Controllers inject
 * these beans once they're implemented.
 */
@Configuration
public class AstraClientConfiguration {

    @Bean
    @Conditional(AstraCredentialsPresentCondition.class)
    public DataAPIClient dataAPIClient(AstraProperties props) {
        return new DataAPIClient(props.token());
    }

    @Bean
    @Conditional(AstraCredentialsPresentCondition.class)
    public Database astraDatabase(DataAPIClient client, AstraProperties props) {
        String keyspace = props.keyspace();
        if (keyspace == null || keyspace.isBlank()) {
            return client.getDatabase(props.endpoint());
        }
        return client.getDatabase(props.endpoint(), keyspace);
    }

    /**
     * Matches when both {@code astra.endpoint} and {@code astra.token} are
     * set to non-blank values. Evaluated at bean-registration time so the
     * factory methods never run with empty credentials.
     */
    static class AstraCredentialsPresentCondition implements ConfigurationCondition {

        @Override
        public ConfigurationPhase getConfigurationPhase() {
            return ConfigurationPhase.REGISTER_BEAN;
        }

        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            String endpoint = context.getEnvironment().getProperty("astra.endpoint");
            String token = context.getEnvironment().getProperty("astra.token");
            return endpoint != null
                    && !endpoint.isBlank()
                    && token != null
                    && !token.isBlank();
        }
    }
}
