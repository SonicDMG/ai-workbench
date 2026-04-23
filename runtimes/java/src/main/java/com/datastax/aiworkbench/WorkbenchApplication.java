package com.datastax.aiworkbench;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * AI Workbench — Java runtime.
 *
 * <p>One of N language "green boxes" that expose the workbench HTTP API at
 * {@code /api/v1/*} and speak Astra's Data API internally via
 * {@code astra-db-java}. Runs as a standalone HTTP server. The UI points
 * at it via {@code BACKEND_URL}.
 */
@SpringBootApplication
public class WorkbenchApplication {

    public static final String VERSION = "0.0.0";

    public static void main(String[] args) {
        SpringApplication.run(WorkbenchApplication.class, args);
    }
}
