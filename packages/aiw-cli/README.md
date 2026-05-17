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
| `aiw doc upload <file>` | Upload a document into a KB. |
| `aiw search <query>` | Run a vector/hybrid search inside a KB. |
| `aiw agent list` | List agents in a workspace. |
| `aiw chat` | Open a chat session with an agent. |
| `aiw job status <id>` | Show the status of an async job. |

Run `aiw <command> --help` for full flags. `--output {human,json}` is
accepted everywhere — `human` is the default; `json` is shaped for
scripting and `jq`.

## Auth

The CLI authenticates with API keys created in the web UI under
**Workspace settings → API keys**. Mutating commands require a key
with the `write` scope; read-only commands accept any valid key.

OIDC device-flow login is on the post-0.1.0 roadmap.

## Development

```bash
cd packages/aiw-cli
npm install
npm run dev -- workspace list --url http://localhost:8080
npm test
```
