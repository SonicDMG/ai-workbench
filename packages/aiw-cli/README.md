# @ai-workbench/cli

> Command-line interface for AI Workbench.

`aiw` talks to a running AI Workbench runtime over its HTTP API. It is
the scripting and automation surface that mirrors the web UI: log in,
list and create workspaces, manage knowledge bases, upload documents,
search, chat with agents, and watch async jobs — all from a terminal
or a shell pipeline.

## Install

```bash
# from npm (after 0.1.0 publish)
npm install -g @ai-workbench/cli

# or run without installing
npx @ai-workbench/cli --help
```

Single-binary builds (no Node required) are attached to each
[GitHub Release](https://github.com/datastax/ai-workbench/releases).

## Quickstart

```bash
# 1. Point the CLI at a runtime and store an API key
aiw login --url http://localhost:8080 --profile dev

# 2. Confirm who you are
aiw whoami

# 3. List workspaces, then upload + search a document
aiw workspace list
aiw doc upload ./paper.pdf --workspace ws_123 --kb kb_456
aiw search "vector indexing" --workspace ws_123 --kb kb_456
```

## Config

Profiles live at one of these paths (first match wins):

| When | Path |
|---|---|
| `AIW_CONFIG_HOME` set | `$AIW_CONFIG_HOME/config.json` |
| Inside the Workbench container (compose sets `WORKBENCH_DATA_DIR`) | `$WORKBENCH_DATA_DIR/cli/config.json` |
| Host-side default | `~/.aiw/config.json` |

The file is mode `0600` and the directory `0700`. One profile per
runtime; switch with `--profile` or the `AIW_PROFILE` environment
variable. Override the runtime URL per-call with `--url`.

Inside the container the canonical invocation is:

```bash
docker compose exec workbench aiw <command>
```

…and the config persists in the same named volume as control-plane
state, so profiles survive `docker compose down/up`.

```json
{
	"active": "dev",
	"profiles": {
		"dev": {
			"url": "http://localhost:8080",
			"apiKey": "wbk_..."
		}
	}
}
```

## Commands

| Command | Description |
|---|---|
| `aiw login` | Save an API key + runtime URL into a profile. |
| `aiw logout` | Remove the active profile's credentials. |
| `aiw whoami` | Show the subject the runtime sees for this profile. |
| `aiw profile ls` | List stored profiles, mark the active one. |
| `aiw profile use <name>` | Switch the active profile. |
| `aiw profile rm <name>` | Delete a stored profile. |
| `aiw status` | One-line health summary for the active profile's runtime. |
| `aiw doctor` | Pre-flight diagnostics (profile / runtime / readiness / auth / MCP / Astra CLI). |
| `aiw doctor --explain <code>` | Print the registry entry for an error code. |
| `aiw completion {bash,zsh,fish}` | Emit a shell-completion script. |
| `aiw workspace list` | List workspaces visible to the active profile. |
| `aiw workspace create <name>` | Create a new workspace. |
| `aiw workspace delete <id>` | Delete a workspace. |
| `aiw kb list` | List knowledge bases inside a workspace. |
| `aiw kb create <name>` | Create a knowledge base. |
| `aiw db workbench <db>` | Print (or `--open`) the Workbench UI URL for an Astra DB. |
| `aiw db ingest <db> --kb <name-or-id> --file <f>` | Upload a file. `<db>` auto-resolves to the workspace; KB accepts a name or UUID. |
| `aiw doc upload <file>` | Upload a document into a KB. |
| `aiw search <query>` | Run a vector/hybrid search inside a KB. |
| `aiw agent list` | List agents in a workspace. |
| `aiw chat` | Open a chat session with an agent. |
| `aiw job status <id>` | Show the status of an async job. |
| `aiw shim install` | Print install command for the bundled `astra` shim. |

Run `aiw <command> --help` for full flags. `--output {human,json}` is
accepted everywhere — `human` is the default; `json` is shaped for
scripting and `jq`.

## Exit codes

Scripts wrapping `aiw` should branch on these — they're stable across
releases and let CI tell "the runtime is down" apart from "the user
supplied a bad flag":

| Code | Meaning |
|---|---|
| `0` | OK |
| `1` | Runtime error (catch-all for non-categorised failures) |
| `2` | Usage error (missing flag, bad input, unknown subcommand) |
| `3` | Auth error (`unauthorized`, `forbidden`, `policy_*`) |
| `4` | Not found (`*_not_found`) |
| `5` | Conflict (`*_conflict`, `*_in_use`, `*_taken`) |
| `6` | Unavailable (`control_plane_unavailable`, `chat_disabled`, `rate_limited`, network failure / timeout) |

The mapping comes from the server-side error code first, then
degrades to the HTTP status. Full table:
[`packages/aiw-cli/src/exit-codes.ts`](./src/exit-codes.ts).

## Network behaviour

Every request has a timeout (default **10s**) and retries network
failures **once** with 250ms backoff. HTTP 4xx/5xx responses never
retry — the server already decided. Tunables:

| Env var | Default | Effect |
|---|---|---|
| `AIW_REQUEST_TIMEOUT_MS` | `10000` | Per-call timeout in milliseconds. |
| `AIW_REQUEST_RETRIES` | `1` | Retries on network/timeout errors. Set `0` to disable. |

Errors carry the runtime's `hint` and `docs` fields (the server-side
error-code registry — see [`docs/errors.md`](../../docs/errors.md))
and are rendered as indented follow-up lines under the `✗` bullet.

## Shell completion

```bash
# bash — add to ~/.bashrc
eval "$(aiw completion bash)"

# zsh — add to ~/.zshrc
eval "$(aiw completion zsh)"

# fish — one-shot, then save:
aiw completion fish | source
aiw completion fish > ~/.config/fish/completions/aiw.fish
```

Completes top-level commands and one level of subcommands (e.g.
`aiw profile <Tab>` → `ls use rm`). Flag-level completion lives in a
later iteration.

## Auth

The CLI authenticates with API keys created in the web UI under
**Workspace settings → API keys**. Mutating commands require a key
with the `write` scope; read-only commands accept any valid key.

OIDC device-flow login is available via `aiw login --oidc`; the CLI
talks to the runtime's `/auth/device/*` endpoints (RFC 8628).

## `astra` shim — one CLI for both worlds

If you already use the [DataStax `astra` CLI](https://docs.datastax.com/en/astra-cli),
this package ships an optional Bash shim that adds two Workbench verbs
under the `astra db` namespace:

```bash
astra db workbench <db>                              # → aiw db workbench
astra db ingest    <db> --kb <name> --file <path>    # → aiw db ingest
```

Both verbs resolve `<db>` to the Workbench workspace bound to that
Astra database (matched by workspace name, by URL substring — handy
for raw Astra DB UUIDs — or by workspace ID).

- `workbench` deep-links to `/workspaces/<id>`. Pass `--workspace <id>`
  to bypass the lookup, or `--open` to launch the URL in your default
  browser. If no workspace matches, the command prints the runtime
  root with `?db=<name>` and a warning to stderr.
- `ingest` auto-resolves `--workspace` from the db positional and
  `--knowledge-base` (or `--kb`) by name, so this just works:

  ```bash
  astra db ingest mydb --kb Support --file ./paper.pdf
  ```

  Pass `--workspace <id>` or a raw UUID for `--kb` to skip the
  respective lookup; the runtime is the source of truth for both.

Every other `astra` invocation (`astra db list`, `astra db cqlsh start
my_db`, `astra org info`, …) is exec'd straight through to the real
binary unchanged, including exit code, stdout, and stderr.

Install:

```bash
# 1. Find the shim and the real astra binary
aiw shim install                # prints a ready-to-run `ln -sf ...`
which astra                     # confirm where the real CLI lives

# 2. Either run the printed `ln -sf …` (puts the shim on a PATH dir
#    that comes before the real astra), or point the shim at it
#    explicitly via $ASTRA_REAL_BIN:
export ASTRA_REAL_BIN="$(which astra)"
ln -sf "$(aiw shim path)" /usr/local/bin/astra
```

Discovery order:

| Lookup | Order |
|---|---|
| Real `astra` | `$ASTRA_REAL_BIN` → `/opt/homebrew/bin/astra`, `/usr/local/bin/astra` → first PATH match that isn't the shim itself |
| `aiw` for routed verbs | `$AIW_BIN` → first PATH match |

## Development

```bash
cd packages/aiw-cli
npm install
npm run dev -- workspace list --url http://localhost:8080
npm test
```
