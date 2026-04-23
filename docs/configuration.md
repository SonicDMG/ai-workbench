# Configuration (`workbench.yaml`)

Runtime behavior is driven by a single YAML file, conventionally named
`workbench.yaml`. The runtime loads it at startup and validates it
against a strict schema.

**Workspaces, catalogs, and vector stores are not in config.** They're
runtime data, mutable via the HTTP API. `workbench.yaml` decides two
things:

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
| `port` | int | `8080` | HTTP listen port |
| `logLevel` | enum | `info` | `trace \| debug \| info \| warn \| error`. The `LOG_LEVEL` env var overrides this when set. |
| `requestIdHeader` | string | `X-Request-Id` | Name of the request-ID header |

### `controlPlane`

Picks where workspaces, catalogs, vector-store descriptors, and
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

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `endpoint` | URL | yes | Astra Data API endpoint |
| `tokenRef` | SecretRef | yes | Pointer to the application token (`env:…` / `file:…`) |
| `keyspace` | string | no (default `workbench`) | Keyspace hosting the four `wb_*` tables |

The runtime creates the `wb_*` tables at startup if they don't exist
(using `createTable(..., { ifNotExists: true })`). The keyspace
itself must already exist.

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
    credentialsRef:
      token: env:ASTRA_DB_APPLICATION_TOKEN
    keyspace: workbench
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Workspace name |
| `kind` | enum | yes | `astra \| hcd \| openrag \| mock` |
| `uid` | UUID | no (auto-generated) | Only useful if other seeds reference it |
| `url` | URL | no | Workspace-specific URL (optional metadata) |
| `credentialsRef` | map<string, SecretRef> | no | Per-key secret pointers |
| `keyspace` | string | no | Workspace-specific keyspace |

Using `seedWorkspaces` with any driver other than `memory` is a
validation error — workspaces already persist in the backend, so
there's nothing to seed.

## `auth`

Configures the `/api/v1/*` auth middleware. See
[`auth.md`](auth.md) for the full contract and rollout plan.

```yaml
auth:
  mode: disabled          # disabled | apiKey | oidc | any
  anonymousPolicy: allow  # allow | reject
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `mode` | enum | `disabled` | Which verifiers are active. Only `disabled` is implemented today; other modes fail loudly at startup. |
| `anonymousPolicy` | enum | `allow` | `allow` lets tokenless requests through as anonymous; `reject` returns `401 unauthorized`. |

The default (`disabled` + `allow`) matches pre-auth behavior: the
middleware runs, tags every request anonymous, and lets it
through. Set `anonymousPolicy: reject` in CI to assert the
middleware is mounted.

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
- Every `tokenRef` / `credentialsRef` value matches the
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
