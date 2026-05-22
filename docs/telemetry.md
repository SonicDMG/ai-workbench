# Telemetry

AI Workbench can optionally emit a small stream of anonymous usage
events. **Telemetry is off by default.** Every event carries only an
anonymous install id, the runtime / CLI version, an event name, and
a small fixed allow-list of categorical fields — never identifiers,
content, paths, or argument values.

This page is the source of truth for what we collect, how to enable
it, and how to turn it off.

## Posture

| Mode | Behavior |
|---|---|
| **OFF** (default) | The emitter is a no-op. No data leaves the process. |
| **ON, dark** | `WORKBENCH_TELEMETRY=1` / `AIW_TELEMETRY=1` set, but no sink URL. Events are constructed and logged; no network call is made. Useful for verifying the wiring before pointing it at a sink. |
| **ON, live** | Plus `WORKBENCH_TELEMETRY_URL=https://…` / `AIW_TELEMETRY_URL=https://…`. Each event becomes one fire-and-forget `POST` with a 2 s timeout. |

Failures to reach the sink **never block the runtime or the CLI**.

## Enabling

### Runtime

```bash
# Container env (compose / Kubernetes / shell):
WORKBENCH_TELEMETRY=1
WORKBENCH_TELEMETRY_URL=https://telemetry.example.com/aiw
```

…or in `workbench.yaml`:

```yaml
runtime:
  telemetry:
    enabled: true
    url: https://telemetry.example.com/aiw   # omit to stay in dark mode
```

Env vars always win over YAML.

### CLI

```bash
export AIW_TELEMETRY=1
export AIW_TELEMETRY_URL=https://telemetry.example.com/aiw
```

The CLI mirror uses the same `installId` as the runtime when both
are bound to the same data volume (`$WORKBENCH_DATA_DIR/.install-id`),
otherwise it persists its own under `$AIW_CONFIG_HOME/.install-id`.

## Event catalog

Every event has this envelope:

```json
{
  "installId": "32-char-hex",
  "version":   "0.2.0",
  "event":     "<name>",
  "fields":    { ... }
}
```

### `runtime_start`

Emitted once per boot, after the HTTP server is listening.

| Field | Type | Values |
|---|---|---|
| `controlPlane` | string | `memory`, `file`, `astra` |
| `authMode` | string | `disabled`, `apiKey`, `oidc`, `any` |
| `environment` | string | `development`, `production` |
| `hasChat` | boolean | `chat` block configured |
| `chatProvider` | string \| null | `huggingface`, `openai`, … (matches `ChatService.providerId`) |

### `error` (runtime)

Emitted from `app.onError` for every error envelope the runtime
returns. Mirrors what lands in the in-memory recent-errors buffer.

| Field | Type | Values |
|---|---|---|
| `code` | string | A registered code from [`docs/errors.md`](./errors.md) (e.g. `workspace_not_found`, `chat_disabled`). |
| `status` | number | The HTTP status that accompanied the envelope. |

### `command_run` (CLI)

Emitted at the top of every `aiw` invocation.

| Field | Type | Values |
|---|---|---|
| `command` | string | The first non-flag argv token (`workspace`, `kb`, `doctor`, …). `<unknown>` if none. |

### `error` (CLI)

Emitted from the top-level catch block.

| Field | Type | Values |
|---|---|---|
| `code` | string | Server-side error code, or `network_error` / `request_timeout` / `config_error` / `runtime_error` / `unknown_error`. |
| `exit` | number | The documented exit code the CLI is about to return (see [`packages/aiw-cli/README.md`](../packages/aiw-cli/README.md#exit-codes)). |

## What we never collect

- Request or response bodies
- Workspace, KB, document, agent IDs or names
- File contents
- API keys, OIDC tokens, or any other secret
- IP addresses or hostnames
- Literal request paths (only categorical labels reach metrics; the
  `error` event omits the path entirely)
- Stack traces

The event field set above is the entire contract — anything not
listed is not sent.

## Opting out

Telemetry is off by default. To explicitly turn it off after
previously enabling it:

```bash
unset WORKBENCH_TELEMETRY
unset WORKBENCH_TELEMETRY_URL
unset AIW_TELEMETRY
unset AIW_TELEMETRY_URL
```

…or in `workbench.yaml`:

```yaml
runtime:
  telemetry:
    enabled: false
```

To rotate your install id (e.g. across environments):

```bash
rm $WORKBENCH_DATA_DIR/.install-id     # runtime
rm $AIW_CONFIG_HOME/.install-id        # CLI
```

The id will be regenerated on the next boot / next invocation.
