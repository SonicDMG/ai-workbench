package com.datastax.aiworkbench.routes;

import com.datastax.aiworkbench.WorkbenchApplication;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Unversioned operational routes. Mirror the shapes emitted by the
 * TypeScript runtime.
 */
@RestController
public class OperationalController {

    @GetMapping("/")
    public Map<String, String> banner() {
        return Map.of(
            "name", "ai-workbench-runtime",
            "runtime", "java",
            "version", WorkbenchApplication.VERSION,
            "docs", "/docs"
        );
    }

    @GetMapping("/healthz")
    public Map<String, String> healthz() {
        return Map.of("status", "ok");
    }

    @GetMapping("/readyz")
    public Map<String, String> readyz() {
        // Phase 1a+ will confirm the Astra client is reachable here.
        return Map.of("status", "ready");
    }

    @GetMapping("/version")
    public Map<String, String> version() {
        return Map.of(
            "version", WorkbenchApplication.VERSION,
            "runtime", "java"
        );
    }
}
