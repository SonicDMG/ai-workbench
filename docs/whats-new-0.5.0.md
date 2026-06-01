# What's new in AI Workbench 0.5.0

0.5.0 is the **"Enterprise Access Control"** release. It turns the
access-control story from *prototype plus coarse roles* into *enforced,
fine-grained, and audited* — so a team can run multi-tenant retrieval workloads
where "who can see what" actually holds at the data plane. Three features land
together: row-level access control (RLAC) enforced on **every** read path,
fine-grained API-key scopes, and access-controlled agent MCP tool-calling.

There is **no breaking wire-contract change** and **no required data migration**
— fine-grained scopes are additive, and RLAC chunk visibility backfills
automatically. See [Upgrading](#upgrading) before turning RLAC on against an
existing deployment.

## Row-level access control now holds — including in agent chat

RLAC has had a complete policy engine and full CRUD for principals and policies
for a while, but it was only enforced on the REST document routes. The hole that
mattered most was **agent retrieval**: an agent's RAG search bypassed policy
entirely, so an agent could surface documents its caller was never allowed to
see. And the data plane was silently inconsistent with the control plane —
chunks carried no visibility, so an RLAC-on search could return nothing.

0.5.0 closes both:

- **Every read path composes the compiled policy filter** — `search_kb`,
  `list_chunks`, `get_document`, document listing, and the Astra `data_api`
  tool. A principal's agent can only retrieve what that principal can see, and
  the vector search applies the filter pre-ANN server-side, so there is no
  recall loss.
- **Chunks are stamped with their document's `visible_to` at ingest**, so the
  data plane matches the control plane. Changing a document's visibility
  re-tags its existing chunks.
- **A single shared in-memory filter interpreter** now backs the mock driver,
  the document-list path, and the conformance mock-Astra server, so `$or` /
  `$and` visibility filters evaluate identically everywhere — no more
  mock-vs-production drift hiding behind green tests.

There is also a **new RLAC admin UI** in workspace settings: an Access Control
card to flip RLAC on or off, a Principals panel (create / edit / delete), and a
read-only Policy Audit panel — the admin surface the docs described but that did
not previously exist.

## Narrowly-scoped API keys

API keys were stuck at three coarse tiers: `read`, `write`, `manage`. 0.5.0 adds
a **fine-grained scope axis** — `read:content`, `read:chat`, `read:audit`,
`write:ingest`, `write:kb`, `write:services`, `write:agents`, `manage:keys`,
`manage:access`, `manage:workspace`, and `tools:invoke` — so you can mint a key
that does exactly one thing: an ingest-only key for a pipeline, a
knowledge-base-admin key for a curator, an audit-read key for compliance.

The trick that makes this safe is **hierarchical containment**: a held scope
grants any scope nested under it, so a coarse `write` key still grants
`write:ingest`. The coarse tiers are supersets of the fine scopes, which means:

- **Your existing keys keep working unchanged** — there is no data migration and
  the default for a new key is still `["read", "write"]`.
- New, narrower keys are opt-in. Mint them where you want least privilege.

A **"Custom (advanced)" scope picker** in the create-key dialog, tier-colored
scope chips in the keys panel, and a new **`aiw key create | list | revoke`**
CLI command (with `--role` presets and repeatable `--scope`) expose the new
axis. Scope-denied requests now record the `requiredScope` in the audit log.

## Agents can call external MCP tools — under a scope

Agents can call tools on registered external MCP servers, now gated by the new
**`tools:invoke`** scope and enforced **per call**: a call from a key that lacks
the scope is denied and audited, never executed. (A coarse `write` key grants
`tools:invoke`, so existing write-capable keys are unaffected.)

Around that gate, 0.5.0 hardens the whole path:

- **Save-time validation.** Creating or updating an agent that references an
  unresolvable `mcp:` / `native:` / `astra:` tool is rejected with
  `422 agent_tool_unresolved`, instead of silently dropping the tool at dispatch.
- **A better tool picker.** The agent form groups tools by server, shows each
  tool's required arguments, and warns about saved tools that no longer resolve
  (with a one-click "remove unavailable tools").
- **Discovery caching.** Per-server tool discovery is memoized with a short TTL,
  so agent turns and form loads don't pay a connection round-trip every time.
- **`tool.invoke` audit rows** now carry `source` and `mcpServerId`.

### Hardening

- **DNS-resolution SSRF parity.** Beyond the literal-host check, an MCP server's
  hostname is resolved and every resolved address re-validated against the same
  egress policy — so a benign-looking name that resolves to `169.254.169.254`
  (or, when private egress is locked down, an internal IP) is refused before any
  connection is opened. On-prem deployments that allow private egress can still
  register internal MCP servers.
- **Prompt-injection bounds.** An untrusted server's advertised tool description
  is length-capped and an oversized advertised input schema is dropped to a
  permissive object, so an external server can't bloat or poison the tool
  manifest the model sees. Descriptions render as inert text, never HTML.

## Upgrading

- **Turning RLAC on for an existing workspace:** new ingests are tagged with
  their visibility automatically, and existing chunks are re-tagged from each
  document's `visibleTo` when you flip RLAC on (and via the backfill script).
  Until a workspace is backfilled, an RLAC-on search reflects only re-tagged
  chunks — flip on, let the backfill run, then verify.
- **Fine-grained scopes need no action.** Existing `read` / `write` / `manage`
  keys keep working unchanged; mint narrower keys only where you want them.
- **Two deliberate behavior changes:** reading the **policy-audit log** now
  requires `manage:access` (a coarse `manage` key still grants it), and an agent
  calling an **external MCP tool** now requires `tools:invoke` (a coarse `write`
  key grants it). Chat message sends remain ungated for read-shaped keys.

See [`CHANGELOG.md`](https://github.com/datastax/ai-workbench/blob/main/CHANGELOG.md)
for the complete list, and [`docs/auth.md`](./auth.md) and [`docs/rlac.md`](./rlac.md)
for the full access-control reference.
