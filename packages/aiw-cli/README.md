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

Profiles live in `~/.aiw/config.json` (mode `0600`). One profile per
runtime; switch with `--profile` or the `AIW_PROFILE` environment
variable. Override the runtime URL per-call with `--url`.

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

## Auth

The CLI authenticates with API keys created in the web UI under
**Workspace settings → API keys**. Mutating commands require a key
with the `write` scope; read-only commands accept any valid key.

OIDC device-flow login is on the post-0.1.0 roadmap.

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
