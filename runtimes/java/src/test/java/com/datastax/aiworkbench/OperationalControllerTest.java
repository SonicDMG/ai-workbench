package com.datastax.aiworkbench;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Sanity tests for the operational endpoints + request-ID middleware.
 * Everything under {@code /api/v1/*} is scaffolded to 501 and is not
 * covered here — see {@link ConformanceTest} for those (currently
 * {@code @Disabled}).
 */
@SpringBootTest
@AutoConfigureMockMvc
class OperationalControllerTest {

    @Autowired private MockMvc mvc;

    @Test
    void healthzReturnsOk() throws Exception {
        mvc.perform(get("/healthz"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("ok"));
    }

    @Test
    void readyzReturnsReady() throws Exception {
        mvc.perform(get("/readyz"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("ready"));
    }

    @Test
    void versionReportsRuntimeTag() throws Exception {
        mvc.perform(get("/version"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.runtime").value("java"))
            .andExpect(jsonPath("$.version").value("0.0.0"));
    }

    @Test
    void bannerCarriesBasicFields() throws Exception {
        mvc.perform(get("/"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("ai-workbench-runtime"))
            .andExpect(jsonPath("$.docs").value("/docs"));
    }

    @Test
    void responsesCarryRequestId() throws Exception {
        mvc.perform(get("/healthz"))
            .andExpect(header().exists("X-Request-Id"));
    }

    @Test
    void echoesClientProvidedRequestId() throws Exception {
        mvc.perform(get("/healthz").header("X-Request-Id", "abc-123"))
            .andExpect(header().string("X-Request-Id", "abc-123"));
    }

    @Test
    void unimplementedRouteReturns501WithEnvelope() throws Exception {
        mvc.perform(get("/api/v1/workspaces"))
            .andExpect(status().isNotImplemented())
            .andExpect(jsonPath("$.error.code").value("not_implemented"))
            .andExpect(jsonPath("$.error.requestId").exists());
    }
}
