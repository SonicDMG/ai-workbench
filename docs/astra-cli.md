# Astra CLI Auto-Configuration

When the [DataStax `astra` CLI](https://github.com/datastax/astra-cli)
is installed and you have at least one configured profile, the
TypeScript runtime can pick up `ASTRA_DB_APPLICATION_TOKEN` and
`ASTRA_DB_API_ENDPOINT` from the CLI at startup — no manual
`.env` editing required.

This is purely a developer convenience layered on top of the
existing env-var contract. The runtime still reads the same two
variables; the CLI integration just fills them in when they're
missing.

## Quick start

```bash
# 1) Install astra-cli (if you haven't already)
brew install datastax/astra-cli/astra
# or follow https://github.com/datastax/astra-cli#installation

# 2) Create a profile (one-time, interactive)
astra setup

# 3) Boot the runtime — it'll discover the profile and prompt for a database
npm run dev
```

If exactly one profile and one database are visible to your token,
the runtime picks them automatically and prints the resolved profile,
database, and region in the boot log.

## Resolution order

The runtime applies each rule in order; first match wins.

1. **Both env vars already set.** If `ASTRA_DB_APPLICATION_TOKEN`
   *and* `ASTRA_DB_API_ENDPOINT` are present in `process.env` (from
   the shell, a `.env` file, a Docker `-e` flag, K8s Secret, etc.)
   the CLI is **not** consulted at all. This keeps existing
   deployments deterministic.
2. **`WORKBENCH_DISABLE_ASTRA_CLI=1`.** Hard off-switch, useful in CI
   where the CLI may be installed but you don't want it consulted.
3. **`astra` binary not on `PATH`.** Skip silently. The runtime
   continues to boot — it's still a no-op when the user hasn't asked
   for Astra anywhere.
4. **CLI consulted.** The runtime runs `astra config list -o json`
   and `astra db list -p <profile> -o json` and applies the rules
   below.

### Profile selection

| Condition | Outcome |
|---|---|
| `ASTRA_PROFILE=<name>` set | Use the named profile (no prompt). |
| Exactly one profile configured | Use it. |
| TTY available, multiple profiles | Prompt the user to choose. |
| Non-TTY, multiple profiles | Use the profile flagged `isUsedAsDefault: true`. |
| Non-TTY, multiple profiles, no default | Skip with a warning. |

### Database selection

| Condition | Outcome |
|---|---|
| `ASTRA_DB=<name-or-id>` set | Use the matching database (no prompt). |
| Exactly one database visible | Use it. |
| TTY available, multiple databases | Prompt the user to choose. |
| Non-TTY, multiple databases | Skip with a warning. |

`TERMINATED` and `TERMINATING` databases are filtered out.

## Environment variables

| Variable | Effect |
|---|---|
| `ASTRA_DB_APPLICATION_TOKEN` | If set, takes precedence over the CLI-resolved value. The runtime never overwrites it. |
| `ASTRA_DB_API_ENDPOINT` | Same precedence as the token. |
| `ASTRA_PROFILE` | Skip the profile prompt by selecting an `astra-cli` profile by name. Same variable astra-cli itself respects. |
| `ASTRA_DB` | Skip the database prompt by selecting a database by name or id. |
| `WORKBENCH_DISABLE_ASTRA_CLI` | `1`/`true` → never consult the CLI. Disables both boot-time auto-detection and the per-workspace `astra-cli:` secret resolver. |

## What gets shown

### Terminal banner

On a successful auto-config, the runtime prints a banner to stdout
*before* the rest of startup, so the selection is impossible to miss:

```
[astra-cli] using profile "workbench-dev"
  database: mydb  (id: 00000000-0000-0000-0000-000000000000)
  region:   us-east-2
  endpoint: https://00000000-0000-0000-0000-000000000000-us-east-2.apps.astra.datastax.com
  keyspace: default_keyspace
  token:    from profile "workbench-dev"
```

If `ASTRA_DB_API_ENDPOINT` was already set in the environment when
the integration ran, the endpoint line is annotated:

```
  endpoint: https://...  (overridden by ASTRA_DB_API_ENDPOINT)
```

The same fields are also emitted as a structured `info` log line so
production deployments can scrape them. Tokens are **never** logged
or printed — only profile name, database name/id, region, and
keyspace.

### Onboarding page

The web UI exposes the inventory on the workspace onboarding page.
After picking the **Astra** (or **HCD**) backend, the user sees a
green picker showing every available profile and the databases each
can see. The first selection auto-populates from the default profile
+ its first database; the user can switch either one at any time.

When the picker is showing, the form's `credentialsRef.token` and
`url` are filled with `astra-cli:<profile>:<dbId>:<token|endpoint>`
refs that the runtime resolves on demand at use-time — see the
[`astra-cli` secret resolver](#per-workspace-astra-cli-secret-refs)
section below.

If the inventory endpoint can't be reached (older runtime, network
blip), the page falls back to the read-only confirmation card built
on `GET /astra-cli` — the boot-time pick — and the form keeps its
legacy `env:ASTRA_DB_APPLICATION_TOKEN` / `env:ASTRA_DB_API_ENDPOINT`
defaults.

### Discovery endpoints

Two operational endpoints surface astra-cli state, both auth-free
(same precedent as `/healthz` / `/version`) and both token-redacted:

#### `GET /astra-cli` — boot-time pick

The single profile + database the runtime auto-selected at startup.
Schema:

```json
{
  "detected": true,
  "profile": "workbench-dev",
  "database": {
    "id": "00000000-0000-0000-0000-000000000000",
    "name": "mydb",
    "region": "us-east-2",
    "endpoint": "https://00000000-0000-0000-0000-000000000000-us-east-2.apps.astra.datastax.com",
    "keyspace": "default_keyspace"
  }
}
```

When detection didn't run or skipped, the response is:

```json
{ "detected": false, "reason": "binary-not-found" }
```

#### `GET /astra-cli/profiles` — full inventory

Every configured profile and the databases each can see. Drives the
onboarding picker. Schema:

```json
{
  "available": true,
  "profiles": [
    {
      "name": "workbench-dev",
      "env": "PROD",
      "isUsedAsDefault": true,
      "databases": [
        {
          "id": "00000000-0000-0000-0000-000000000000",
          "name": "mydb",
          "region": "us-east-2",
          "endpoint": "https://00000000-0000-0000-0000-000000000000-us-east-2.apps.astra.datastax.com",
          "keyspace": "default_keyspace"
        }
      ]
    }
  ]
}
```

When the CLI isn't installed, disabled, or returns an error:

```json
{ "available": false, "reason": "binary-not-found" }
```

A failing per-profile listing surfaces as that profile with an empty
`databases` array — the rest of the inventory still renders so the
user can pick a working profile.

## Per-workspace `astra-cli` secret refs

Workspace `credentialsRef` values can carry the `astra-cli:` prefix
to source a token + endpoint from a specific CLI profile + database
on demand:

```
astra-cli:<profile>:<dbId>:token
astra-cli:<profile>:<dbId>:endpoint
```

- `profile` — name of an `astra config list` entry
- `dbId` — UUID-shaped database id from `astra db list` (names
  are mutable; ids aren't, so workspace records bind to the
  immutable identifier)
- `token` resolves to the profile's API token; `endpoint` resolves
  to `https://<dbId>-<region>.apps.astra.datastax.com`

The resolver caches profile + database listings for the process
lifetime, so a workspace creating ten knowledge bases doesn't
re-shell out ten times. Errors aren't cached — a transient CLI
failure recovers on the next attempt.

When the picker is open in the onboarding UI, this is the ref scheme
it generates. Operators editing `workbench.yaml` directly can also
write these refs by hand for `seedWorkspaces`. The same paths work
for any field that takes a `SecretRef`.

When the `astra` binary isn't on `PATH`, every `astra-cli:` resolve
fails with an actionable error pointing the operator at
[https://github.com/datastax/astra-cli](https://github.com/datastax/astra-cli)
or suggesting they replace the ref with a literal `env:` token.

## Troubleshooting

| Boot log message | Meaning | Fix |
|---|---|---|
| `astra cli not found on PATH` (debug level) | The runtime didn't find an `astra` binary. | Install it or set `WORKBENCH_DISABLE_ASTRA_CLI=1` to silence. |
| `astra config list failed` | The CLI returned a non-zero exit. Most often: profile expired or the CLI isn't set up yet. | `astra setup` or `astra config list` to confirm. |
| `astra-cli profile has no accessible databases` | The token associated with the profile sees zero non-terminated databases. | Create a database in the Astra console, or pick a different profile. |
| `could not determine which astra-cli profile to use` | Multiple profiles, non-interactive shell, no `isUsedAsDefault`. | Set `ASTRA_PROFILE`. |
| `could not determine which astra database to use` | Multiple databases, non-interactive shell. | Set `ASTRA_DB` to a database name or id. |

## CI / production

Most production deployments inject `ASTRA_DB_APPLICATION_TOKEN` and
`ASTRA_DB_API_ENDPOINT` from a secret manager — in which case the
CLI integration is automatically inert (rule 1 above). For
belt-and-braces hardening you can also set
`WORKBENCH_DISABLE_ASTRA_CLI=1` to guarantee the CLI is never
shelled out to.

## Related

- [`configuration.md`](configuration.md) — how the runtime reads
  Astra credentials in general.
- [`workspaces.md`](workspaces.md) — how workspace `credentialsRef`
  values flow back through the same env vars.
