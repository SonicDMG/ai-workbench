# MCP trust (toolprint)

AI Workbench both **hosts** an MCP server (`src/mcp/server.ts`, exposed at
`/api/v1/workspaces/{workspaceId}/mcp`) and lets agents **connect to
external** MCP servers as tools. In both cases an agent reads each tool's
*description* and *input schema* to decide what to do — so a server that
silently rewrites a tool's description (a "rug-pull") can redirect an
agent without anyone noticing. It's the classic tool-poisoning vector.

We guard against this the same way we guard dependency versions: with a
committed lockfile. [`toolprint`](https://github.com/jestatsio/toolprint)
("`package-lock.json` for MCP trust") lists every tool/prompt/resource a
server advertises, hashes each definition, and pins them into
[`toolprint.lock`](../toolprint.lock). On every change it diffs the live
surface against the pin — drift shows up as a reviewable diff and **fails
CI** ([`.github/workflows/toolprint.yml`](../.github/workflows/toolprint.yml)).
toolprint only ever calls `tools/list`; it never executes a tool.

## What's pinned

| Target | Source | Why |
|---|---|---|
| Our own MCP server | booted hermetically — see below | A code change that alters a tool's description/schema is a contract change to every agent that connects. Catch it in review. |
| Trusted external servers | [`.toolprint/mcp.json`](../.toolprint/mcp.json) | An upstream server we depend on could rug-pull between releases. The weekly CI cron catches it even with no PR. |

`.toolprint/mcp.json` is the curated list of external MCP servers this
project trusts. Add the servers your team actually uses; each entry's
tool surface gets pinned on the next re-pin.

## Run it locally

```bash
npm run security:mcp            # scan — fails on drift, injection, or leaked secrets
npm run security:mcp -- --pin   # re-pin after an *intended* change, then commit toolprint.lock
```

The scan boots the runtime hermetically via
[`examples/workbench.toolprint-ci.yaml`](../runtimes/typescript/examples/workbench.toolprint-ci.yaml)
(memory control plane, one seeded mock workspace, default open-auth
posture) on `http://localhost:8099`, scans, and tears it down. No Astra,
secrets, LLM, or network backend required.

## When the check fails

1. **Unintended drift** — a tool's description/schema changed without you
   meaning to, or an external server rug-pulled. Investigate before
   trusting it; this is the case the check exists for.
2. **Intended change** — you deliberately edited the MCP surface (added a
   tool, reworded a description). Re-pin and commit:
   ```bash
   npm run security:mcp -- --pin && git add toolprint.lock
   ```
   The `toolprint.lock` diff is part of code review, so a reviewer sees
   exactly which tool definitions changed.

## Notes / limitations

- **Gate severity.** toolprint classifies a rug-pull as `medium`, so the
  scan runs `--fail-on medium` (its default `high` would let a rug-pull
  pass). See `scripts/toolprint-mcp.mjs`.
- **Auth.** toolprint can't yet send an `Authorization` header to an HTTP
  target, so the own-server scan runs with auth disabled in the hermetic
  config. This does not affect the deployed runtime's auth posture; it's
  only how the scanner reaches a throwaway local instance.
