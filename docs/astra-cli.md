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
| `WORKBENCH_DISABLE_ASTRA_CLI` | `1`/`true` → never consult the CLI. |

## What gets logged

On a successful auto-config, the runtime emits:

```
astra-cli credentials applied profile=<name> database=<name> region=<region>
```

Tokens are **never** logged. Only profile name, database name/id,
and region.

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
