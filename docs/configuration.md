# Configuration (`workbench.yaml`)

Runtime behavior is driven by a single YAML file, conventionally named
`workbench.yaml`. The runtime loads it at startup and validates it
against a strict schema.

**Workspaces, knowledge bases, and execution services are not in
config.** They're runtime data, mutable via the HTTP API.
`workbench.yaml` decides two things:

1. Where that data is persisted (the **control-plane backend**).
2. Optionally, which **seed workspaces** to load into the memory
   backend at startup.

## Resolution order

The runtime looks for the config file in this order and takes the
first match:

1. `--config <file>` CLI flag.
2. `WORKBENCH_CONFIG` environment variable.
3. `./workbench.yaml` in the process working directory.
4. `./examples/workbench.yaml` — the sample config this runtime
   ships with. Lets `npm run dev` work out-of-the-box when run from
   the runtime directory.
5. `/etc/workbench/workbench.yaml` (the Docker image default).

No cross-source merging — config is a single declarative document.
`--config` and `WORKBENCH_CONFIG` are returned verbatim; they fail
loudly if the target doesn't exist rather than silently falling
through to the next step.

## Environment variable interpolation

Any string value may reference an environment variable with `${VAR}`
or `${VAR:-default}` syntax. Interpolation happens before schema
validation.

```yaml
controlPlane:
  driver: astra
  endpoint: ${ASTRA_DB_API_ENDPOINT}
  tokenRef: env:ASTRA_DB_APPLICATION_TOKEN
```

References to unset variables without a default fail loudly at
startup.

**Note:** `tokenRef` above is a `SecretRef` string, not an
interpolation. Secret refs are resolved at use time by the runtime's
`SecretResolver`, which is separate from YAML interpolation. See
[§ Secrets](#secrets) below.

## Top-level schema

```yaml
version: 1                          # required
runtime: { port, logLevel, ... }    # optional, with defaults
controlPlane: { driver, ... }       # optional, default: memory
seedWorkspaces: [ ... ]             # optional, memory-only
```

### `version`

Schema version. Currently `1`. The runtime refuses to start on an
unknown version.

### `runtime`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `environment` | enum | `development` | `development \| production`. Production mode enforces durable persistence, enabled auth, rejected anonymous traffic, HTTPS `publicOrigin`, and a persistent OIDC session secret when browser login is configured. |
| `port` | int | `8080` | HTTP listen port |
| `logLevel` | enum | `info` | `trace \| debug \| info \| warn \| error`. The `LOG_LEVEL` env var overrides this when set. |
| `requestIdHeader` | string | `X-Request-Id` | Name of the request-ID header |
| `uiDir` | string \| null | `null` | Directory of pre-built UI assets to serve from `/` (with SPA fallback). `null` auto-detects `/app/public` → `${cwd}/public` → `${cwd}/apps/web/dist`. The `UI_DIR` env var also works as an override. The official Docker image sets this up automatically. |
| `replicaId` | string \| null | `null` | Identifier this replica writes into job leases (used by the cross-replica orphan sweeper to tell whose lease is whose). `null` auto-generates `${HOSTNAME or "wb"}-<short-uuid>` at boot — fine for single-replica deployments and tests; set explicitly for clustered runs if you want the lease holder to be deterministic. |
| `publicOrigin` | URL \| null | `null` | Externally visible browser origin, e.g. `https://workbench.example.com`. Used for OIDC redirect URI construction and secure-cookie decisions. Required for production OIDC browser login. |
| `trustProxyHeaders` | boolean | `false` | Trust `X-Forwarded-Proto` / `X-Forwarded-Host` when `publicOrigin` is not set. Also extends to the rate limiter (`X-Forwarded-For` / `X-Real-IP`). Enable only behind a trusted proxy that overwrites those headers. |
| `rateLimit` | object | (defaults below) | In-process per-IP rate limiter. See [§ Rate limiting](#rate-limiting). |

Production deployments should start from
[`runtimes/typescript/examples/workbench.production.yaml`](../runtimes/typescript/examples/workbench.production.yaml).

#### Rate limiting

Defense-in-depth limiter applied to `/api/v1/*` (capacity from
config) and `/auth/*` (a tighter fixed cap of 30 req/window — login
flows shouldn't burst). Per-IP, per-replica fixed window. Distributed
deployments should still front the runtime with an upstream WAF /
API gateway for accurate aggregate ceilings; this layer protects
against runaway clients and naive scanners.

```yaml
runtime:
  rateLimit:
    enabled: true        # default
    capacity: 600        # max requests per window per IP for /api/v1/*
    windowMs: 60000      # window length, ms
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `enabled` | bool | `true` | Set `false` to skip the limiter entirely. |
| `capacity` | int (1–1_000_000) | `600` | Per-IP requests per window for `/api/v1/*`. The auth surface uses a fixed `30`. |
| `windowMs` | int (1000–3_600_000) | `60000` | Window length in milliseconds. |

Rejected requests get `429 Too Many Requests` with the canonical
error envelope, a `Retry-After` header (seconds), and
`X-RateLimit-{Limit,Remaining,Reset}` headers on every response.
Client IP is derived from the socket; set
`runtime.trustProxyHeaders: true` to honor `X-Forwarded-For` /
`X-Real-IP` instead.

### `controlPlane`

Picks where workspaces, knowledge bases, execution services, and RAG
documents are persisted. Discriminated on `driver`.

#### `memory` (default)

```yaml
controlPlane:
  driver: memory
```

In-process `Map`s. State is lost when the runtime exits. Best for CI,
tests, ephemeral demos, and `docker run` with no external
dependencies. If you don't specify a `controlPlane` block at all,
this is what you get.

#### `file`

```yaml
controlPlane:
  driver: file
  root: /var/lib/workbench
```

JSON-on-disk. One file per table, per-table mutex, atomic rename on
writes. Single-node self-hosted. Not safe for multiple writers — if
you run two containers pointing at the same directory, they'll
clobber each other.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `root` | string | yes | Directory that will hold `workspaces.json` et al. Created if absent. |

#### `astra`

```yaml
controlPlane:
  driver: astra
  endpoint: https://<db-id>-<region>.apps.astra.datastax.com
  tokenRef: env:ASTRA_DB_APPLICATION_TOKEN
  keyspace: workbench
```

Astra Data API Tables via `@datastax/astra-db-ts`. Production-grade,
multi-writer-safe.

> **Tip — astra-cli auto-config.** If you have the
> [`astra` CLI](https://github.com/datastax/astra-cli) installed and a
> profile configured, you can leave `ASTRA_DB_APPLICATION_TOKEN` and
> `ASTRA_DB_API_ENDPOINT` unset locally — the runtime will pick them
> up from the CLI at startup. Production deployments inject them from
> a secret manager and the CLI integration is automatically inert.
> See [`astra-cli.md`](astra-cli.md).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `endpoint` | URL | yes | Astra Data API endpoint |
| `tokenRef` | SecretRef | yes | Pointer to the application token (`env:…` / `file:…`) |
| `keyspace` | string | no (default `workbench`) | Keyspace hosting the `wb_*` control-plane tables |
| `jobPollIntervalMs` | int (50–60000) | `500` | Cross-replica job-subscriber poll interval in ms. Each subscribed `(workspace, jobId)` pair is re-read at this cadence so SSE clients on a different replica from the worker still see updates. Same-replica updates fan out instantly; the poller is a no-op when no one is subscribed. Raise for cost-sensitive deployments where second-scale staleness is fine; lower for hot SSE paths. Astra-only — `memory` and `file` are single-replica by definition. |
| `jobsResume` | object | off | Cross-replica orphan-sweeper config. See below. |

The runtime creates the `wb_*` tables at startup if they don't exist
(using `createTable(..., { ifNotExists: true })`). The keyspace
itself must already exist.

#### `controlPlane.jobsResume` (memory / file / astra)

Off by default — only useful for clustered deployments where one
replica can crash mid-ingest while another stays up. Single-replica
operators don't need it (their pipelines always fail-fast on the
same process). When enabled, every replica scans the durable job
store on an interval for `running` jobs whose lease is older than
the grace window and CAS-claims them. Jobs with a persisted ingest
snapshot replay the pipeline idempotently; older rows without a
snapshot still become terminal `failed` records so SSE clients do
not hang forever. See
[`cross-replica-jobs.md`](cross-replica-jobs.md).

```yaml
controlPlane:
  driver: astra
  endpoint: https://...
  tokenRef: env:ASTRA_DB_APPLICATION_TOKEN
  jobsResume:
    enabled: true
    graceMs: 60000     # how stale a lease must be before reclaim
    intervalMs: 60000  # how often each replica scans
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `enabled` | bool | `false` | Set to `true` to start the sweeper. Off by default; clustered deployments opt in. |
| `graceMs` | int (1000–600000) | `60000` | Maximum age of a lease (relative to last heartbeat) before the job is considered orphaned. |
| `intervalMs` | int (1000–600000) | `60000` | How often each replica scans for stale leases. |

Heartbeats are stamped on every progress update (`processed`
ticking, status flipping), so any active worker keeps its lease
fresh. Each replica writes its own `replicaId` (see
[`runtime.replicaId`](#runtime)) into `leasedBy` so the sweeper can
tell what claim belongs to whom.

### `seedWorkspaces` *(memory only)*

Optional list of workspace records loaded into the memory backend at
startup. Lets developers skip the `POST /api/v1/workspaces` dance
when running locally.

```yaml
seedWorkspaces:
  - name: demo
    kind: mock
  - name: prod-astra
    kind: astra
    url: env:ASTRA_DB_API_ENDPOINT
    credentials:
      token: env:ASTRA_DB_APPLICATION_TOKEN
    keyspace: workbench
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Workspace name |
| `kind` | enum | yes | `astra \| hcd \| openrag \| mock` |
| `uid` | UUID | no (auto-generated) | Only useful if other seeds reference it |
| `url` | URL or SecretRef | no | Workspace-specific data-plane URL |
| `credentials` | map<string, SecretRef> | no | Per-key secret pointers |
| `keyspace` | string | no | Workspace-specific keyspace |

Using `seedWorkspaces` with any driver other than `memory` is a
validation error — workspaces already persist in the backend, so
there's nothing to seed.

## `chat` *(optional)*

Wires up chat-with-Bobbie. When unset, the chat CRUD routes still
work but `POST .../messages` and `POST .../messages/stream` return
`503 chat_disabled`. See [`chat.md`](chat.md) for the full feature
walkthrough.

```yaml
chat:
  tokenRef: env:HUGGINGFACE_API_KEY
  model: mistralai/Mistral-7B-Instruct-v0.3
  maxOutputTokens: 1024
  retrievalK: 6
  systemPrompt: null
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `tokenRef` | SecretRef | required | Resolved once at boot. `env:VAR` or `file:/path`. |
| `model` | string | `mistralai/Mistral-7B-Instruct-v0.3` | Any chat-completion-compatible HuggingFace Inference API model. |
| `maxOutputTokens` | int (1–8192) | `1024` | Per-turn cap on the assistant's reply length. |
| `retrievalK` | int (1–64) | `6` | Top-K KB chunks **per knowledge base**. The total injected into the prompt is `retrievalK * ceil(sqrt(numKbs))` so multi-KB chats don't blow up the prompt. |
| `systemPrompt` | string \| null | `null` | Override Bobbie's built-in persona. `null` keeps the default. |

## `auth`

Configures the `/api/v1/*` auth middleware. See
[`auth.md`](auth.md) for the full contract and rollout plan.

```yaml
auth:
  mode: disabled          # disabled | apiKey | oidc | any
  anonymousPolicy: allow  # allow | reject
  # oidc: …               # required when mode is `oidc` or `any`
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `mode` | enum | `disabled` | Which verifiers are active. |
| `anonymousPolicy` | enum | `allow` | `allow` lets tokenless requests through as anonymous; `reject` returns `401 unauthorized`. |
| `bootstrapTokenRef` | SecretRef \| null | `null` | Optional 32+ character break-glass bearer token. Accepted as an unscoped operator subject when `mode` is `apiKey`, `oidc`, or `any`; invalid with `mode: disabled`. |
| `oidc` | object | — | Required when `mode` is `oidc` or `any`. See table below. |

The default (`disabled` + `allow`) matches pre-auth behavior: the
middleware runs, tags every request anonymous, and lets it
through. Set `anonymousPolicy: reject` in CI to assert the
middleware is mounted.

### `auth.oidc`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `issuer` | url | required | Must equal the JWT `iss` claim exactly. Discovery URL is derived from this. |
| `audience` | string \| string[] | required | At least one value must match the JWT `aud` claim. |
| `jwksUri` | url \| null | `null` | When null, the runtime fetches `${issuer}/.well-known/openid-configuration` at startup and uses `jwks_uri` from the response. |
| `clockToleranceSeconds` | int | `30` | Skew allowance for `exp` / `nbf`. |
| `claims.subject` | string | `sub` | JWT claim → `AuthSubject.id`. |
| `claims.label` | string | `email` | JWT claim → `AuthSubject.label` (nullable). |
| `claims.workspaceScopes` | string | `wb_workspace_scopes` | Array-valued claim → `AuthSubject.workspaceScopes`. A JSON `null` marks the subject unscoped (admin). |
| `client` | object | — | Optional. When present, the runtime hosts `/auth/{login,callback,me,logout}` so the bundled web UI can drive a browser PKCE login. See table below. |

#### `auth.oidc.client`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `clientId` | string | required | OAuth client identifier registered at the IdP. |
| `clientSecretRef` | SecretRef \| null | `null` | Client secret. Omit for public (SPA-style) clients. |
| `redirectPath` | string | `/auth/callback` | Path the IdP redirects to after authorization. Must be in the IdP's allow-list. |
| `postLogoutPath` | string | `/` | Where `/auth/logout` sends the user. |
| `scopes` | string[] | `[openid, profile, email]` | OAuth scopes requested at login. |
| `sessionCookieName` | string | `wb_session` | Cookie that carries the encrypted session. |
| `sessionSecretRef` | SecretRef \| null | `null` | Key material for encrypting session cookies. Must resolve to ≥32 bytes. When null, runtime auto-generates an ephemeral key at boot (dev only). |

## Secrets

Secrets reach the runtime through two disjoint paths:

### YAML interpolation (`${VAR}`)

Applies before schema validation. Good for non-secret runtime
settings like endpoints, and for pulling secrets that need to be
**literal strings** in the config document.

### Secret refs (`env:` / `file:`)

The preferred path for anything credential-shaped. A `SecretRef` is a
string like `env:ASTRA_DB_APPLICATION_TOKEN` or
`file:/etc/workbench/secrets/astra-token`. The runtime resolves it
when it actually needs the secret (at control-plane init, for
example), so the value never lives in memory longer than necessary
and never crosses process logs.

Providers available today:

| Provider | Ref shape | Behavior |
|---|---|---|
| `env` | `env:VAR_NAME` | Reads `process.env.VAR_NAME`. Errors if unset or empty. |
| `file` | `file:/abs/path` | Reads the file and trims trailing whitespace. |

Future providers (Vault, AWS SM, etc.) plug into the same
`SecretProvider` interface. See
[`runtimes/typescript/src/secrets/provider.ts`](../runtimes/typescript/src/secrets/provider.ts).

## Validation rules

At startup the runtime enforces:

- Every `${VAR}` reference resolves or has a default.
- `controlPlane.driver` is one of `memory | file | astra`.
- Driver-specific required fields are present (e.g. `root` for file,
  `endpoint` + `tokenRef` for astra).
- Every `tokenRef` / `credentials` value matches the
  `<prefix>:<path>` shape.
- `seedWorkspaces` is only non-empty when
  `controlPlane.driver == memory`.
- No duplicate names within `seedWorkspaces`.

Validation failures abort startup with a non-zero exit code and a
human-readable error message.

## Hot reload

Not supported. The current model is "restart the process to pick up
changes." Since only the control-plane backend is configured here
(workspaces themselves are runtime data), most day-to-day operations
don't require a config change anyway.

## Graceful shutdown

`SIGINT` and `SIGTERM` trigger a graceful-shutdown sequence:

1. `/readyz` starts returning `503 draining`. Kubernetes-style
   readiness probes will stop routing traffic here.
2. `server.close()` stops accepting new connections. In-flight
   requests keep going.
3. When every connection finishes (or after 15 seconds, whichever
   comes first), the control-plane store closes and the process
   exits `0`. A timeout exits `1` so the supervisor knows we didn't
   drain cleanly.
4. A second `SIGINT` / `SIGTERM` while the first is still draining
   short-circuits straight to exit — the operator can force-kill a
   stuck process without waiting for the timeout.

`/healthz` stays `200` throughout the drain (the process is still
alive, just closed to new traffic). That's the split that k8s
expects — `livenessProbe` hits `/healthz`, `readinessProbe` hits
`/readyz`.

## `.env` file (dev convenience)

The runtime auto-loads a `.env` file at startup so local dev doesn't
need you to `export` secrets by hand. Uses Node 21.7+'s built-in
`process.loadEnvFile` — no `dotenv` dependency.

**Location.** Put it at the **repo root**. The runtime walks up from
the process's current working directory looking for `.env`, stopping
at the repo root (`.git` sentinel). That means the same file works
whether you run `npm run dev` from the repo root or from
`runtimes/typescript/`.

**Precedence.** Values already present in `process.env` win —
`.env` never overwrites shell exports or container env vars. Matches
every other dotenv loader.

**Override the path.** Set `WORKBENCH_ENV_FILE=/abs/path/to/.env` to
skip the walk and load an explicit file (missing files fail loudly).
Useful for production container boots where the token lives on a
mounted secret.

**Template.** [`.env.example`](../.env.example) at the repo root is
a committed starting point — copy to `.env` and fill in the secrets
you need. `.env` itself is gitignored.

**Production.** The runtime ships the same loader in production, but
standard container practice (Docker `-e` / K8s Secrets → env vars)
usually means no `.env` is present and the loader silently skips.

## Examples

- [`runtimes/typescript/examples/workbench.yaml`](../runtimes/typescript/examples/workbench.yaml) —
  the minimal default config the Docker image ships with.
- [`docs/examples/workbench.yaml`](examples/workbench.yaml) — an
  annotated sample showing all three backend shapes and
  `seedWorkspaces` usage.
