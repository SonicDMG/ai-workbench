package com.datastax.aiworkbench;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

/**
 * Cross-runtime conformance harness, Java side.
 *
 * <p>When implemented, this class will replay every scenario in
 * {@code conformance/scenarios.json} against the in-process Spring Boot
 * app (via {@code MockMvc} or {@code WebTestClient}), normalize the
 * captured responses, and diff them against the shared fixtures at
 * {@code conformance/fixtures/&lt;slug&gt;.json}.
 *
 * <p>Every test is {@code @Disabled} today because every
 * {@code /api/v1/*} route is scaffolded to 501. Flip each one as the
 * matching controller starts returning real data.
 *
 * <p>The shared normalizer ({@code conformance/normalize.mjs}) is JS,
 * so the Java harness will need a port — kept intentionally small so
 * cross-language equivalence is easy to verify. Keep the placeholder
 * names identical ({@code UUID_N}, {@code TS}, {@code REQID_N}).
 */
class ConformanceTest {

    @Test
    @Disabled("pending: implement POST/GET/PUT/DELETE workspace routes")
    void workspaceCrudBasic() {}

    @Test
    @Disabled("pending: implement catalog routes")
    void catalogUnderWorkspace() {}

    @Test
    @Disabled("pending: implement vector-store descriptor routes")
    void vectorStoreDefinition() {}

    @Test
    @Disabled("pending: implement vector-store data plane (upsert, search, delete)")
    void vectorStoreUpsertAndSearch() {}

    @Test
    @Disabled("pending: implement document metadata CRUD")
    void documentCrudBasic() {}
}
