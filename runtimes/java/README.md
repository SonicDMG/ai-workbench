# AI Workbench — Java runtime

One of N language **green boxes** for AI Workbench. A Spring Boot app
that exposes the same `/api/v1/*` surface as the TypeScript runtime,
talking to Astra via
[`astra-db-java`](https://github.com/datastax/astra-db-java) internally.

The UI picks which green box to target at deploy time via
`BACKEND_URL`. Deploy this runtime as a Docker container and point the
UI at it — no changes needed on the UI side.

## Status

**Scaffold.** The Spring Boot app boots, the operational endpoints
(`/healthz`, `/readyz`, `/version`, `/`) work, and `/docs` redirects to
Swagger UI. Every `/api/v1/*` route currently throws
`NotImplementedApiError` → HTTP 501 with the canonical error envelope.

## Prerequisites

- **JDK 21** (LTS). Check with `java -version`.
- **Gradle 8.14+** — or generate the wrapper (see "Gradle wrapper" below)
  and use `./gradlew` instead.

## Quickstart

```bash
cd runtimes/java

# If the Gradle wrapper is missing from this directory, generate it once:
gradle wrapper --gradle-version 8.14.3

# From here on use the wrapper — no system Gradle needed.
./gradlew bootRun                                # http://localhost:8080
```

Then:

```bash
curl http://localhost:8080/healthz        # {"status":"ok"}
curl http://localhost:8080/version        # build metadata with "runtime":"java"
open  http://localhost:8080/docs          # Swagger UI
```

Run the (small) test suite:

```bash
./gradlew test
```

You'll see the operational-endpoint tests pass. Conformance tests are
disabled via `@Disabled` until the routes are implemented — flip each
one as you go.

## Where to start implementing

Each `NotImplementedApiError` in
[`src/main/java/com/datastax/aiworkbench/routes/`](./src/main/java/com/datastax/aiworkbench/routes/)
corresponds to one step in
[`../../conformance/scenarios.md`](../../conformance/scenarios.md).
Suggested order:

1. `POST /api/v1/workspaces` — scenario `workspace-crud-basic` step 1.
   Add an `astra` package that wraps `astra-db-java` for the `wb_*`
   tables, and wire it into `WorkspaceController`.
2. `GET` / `PUT` / `DELETE` for workspaces — completes the workspace
   scenarios.
3. Chunking / embedding / reranking service CRUD.
4. Knowledge-base CRUD with auto-provisioned vector collections.
5. KB data plane + documents + ingest.

Every time you flip a conformance test green, remove its `@Disabled`
annotation in
[`ConformanceTest`](./src/test/java/com/datastax/aiworkbench/ConformanceTest.java)
so CI catches future drift.

## Internal layers

Once you start calling Astra:

```
@RestController handler
    ↓
com.datastax.aiworkbench.astra.*    ← astra-db-java-backed helpers for wb_* tables
    ↓
astra-db-java                       ← DataStax-maintained SDK
    ↓
Astra Data API (HTTPS)
```

Keep controllers thin — validate with Jakarta Bean Validation (free
via Spring Boot), call the Astra layer, return the response record.
Business logic that isn't just "forward to astra-db-java" stays out
of the controllers.

Don't build a separate `workbench-astra-client` library. The
workbench-specific mapping between `WorkspaceRecord` and a Data API
Table row is runtime-internal — not something we publish.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `WORKBENCH_HOST` | `0.0.0.0` | Bind address (`server.address`) |
| `WORKBENCH_PORT` | `8080` | Listen port (`server.port`) |
| `WORKBENCH_LOG_LEVEL` | `INFO` | Root log level |
| `ASTRA_DB_API_ENDPOINT` | *(unset)* | Astra Data API URL |
| `ASTRA_DB_APPLICATION_TOKEN` | *(unset)* | Astra application token |
| `ASTRA_DB_KEYSPACE` | `workbench` | Keyspace hosting `wb_*` tables |

Overrides flow through
[`src/main/resources/application.yml`](./src/main/resources/application.yml).
Standard Spring Boot env-var / profile overrides apply.

The UI discovers this runtime via its own `BACKEND_URL` env var —
that's the UI's concern, not the runtime's.

## Conformance behavior

[`ConformanceTest`](./src/test/java/com/datastax/aiworkbench/ConformanceTest.java)
will eventually run every scenario as HTTP requests against the Spring
Boot app (in-process via `MockMvc` or `WebTestClient`). Responses are
compared to shared fixtures in
[`../../conformance/fixtures/`](../../conformance/fixtures/).

Fixtures ship from the canonical TypeScript runtime via
`npm run conformance:regenerate`. The Java runtime's conformance tests
stay `@Disabled` until the matching controllers are implemented; flip
them per scenario as you go.

The mock-astra server is a **shared deterministic backend** for every
green box — not a conformance assertion target. Point the runtime's
`ASTRA_DB_API_ENDPOINT` at it during tests so every language sees the
same Astra responses.

## Structure

```
runtimes/java/
├── build.gradle.kts                                           ← Spring Boot + astra-db-java (pending)
├── settings.gradle.kts
├── gradle.properties
├── README.md                                                  ← you are here
├── src/
│   ├── main/
│   │   ├── java/com/datastax/aiworkbench/
│   │   │   ├── WorkbenchApplication.java                      ← Spring Boot entry
│   │   │   ├── error/
│   │   │   │   ├── ApiError.java                              ← base + subclasses
│   │   │   │   ├── ErrorEnvelope.java                         ← response shape
│   │   │   │   └── GlobalExceptionHandler.java                ← @ControllerAdvice
│   │   │   ├── web/
│   │   │   │   └── RequestIdFilter.java                       ← X-Request-Id
│   │   │   ├── model/                                         ← records mirroring TS types
│   │   │   └── routes/                                        ← scaffold; align with TS routes when implemented
│   │   │       ├── OperationalController.java                 ← working: /healthz, /readyz, /version, /
│   │   │       ├── WorkspaceController.java                   ← 501 stubs
│   │   │       ├── ServicesController.java                    ← chunking/embedding/reranking — 501 stubs
│   │   │       ├── KnowledgeBaseController.java               ← 501 stubs
│   │   │       └── DocumentController.java                    ← 501 stubs
│   │   └── resources/
│   │       └── application.yml
│   └── test/
│       └── java/com/datastax/aiworkbench/
│           ├── OperationalControllerTest.java                 ← passing
│           └── ConformanceTest.java                           ← @Disabled until implemented
```

## Type mirroring

Java records in
[`src/main/java/com/datastax/aiworkbench/model/`](./src/main/java/com/datastax/aiworkbench/model/)
mirror the TypeScript types in
[`../typescript/src/control-plane/types.ts`](../typescript/src/control-plane/types.ts).
When the TS types change, update the Java records in the same PR.

JSON over the wire uses `camelCase` (matching TS). Java records use
camelCase too, so Jackson maps them 1:1 with no custom configuration.

## Gradle wrapper

The `./gradlew` scripts and `gradle/wrapper/gradle-wrapper.jar` are not
committed to keep the scaffold text-only. Generate them once on first
checkout:

```bash
gradle wrapper --gradle-version 8.14.3
```

After that, commit the generated wrapper files in your first
implementation PR so CI and downstream contributors don't need a
system Gradle install.

## House rules

- **Use Java records** for DTOs. Keep them immutable; no setters.
- **Thin controllers** — validation and mapping in the controller,
  domain logic in the `astra` package.
- **No `System.out.println`** — use SLF4J (`LoggerFactory.getLogger`).
- **Format with `google-java-format`** before committing. Wire it into
  Gradle via the Spotless plugin in your first real PR.

## Publishing

Not publishing to Maven Central yet. For now, run from source or build
and deploy the container image. A Maven Central release will gate on:

1. Conformance passing against a real Astra endpoint (not just mock).
2. All Phase 1a scenarios implemented.
3. A release workflow in `.github/workflows/`.
