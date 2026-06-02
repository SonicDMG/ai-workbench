# RLAC on Documents

Row-Level Access Control on Documents landed as a prototype in
[#237](https://github.com/datastax/ai-workbench/pull/237), was
labeled Preview through 0.1.x and 0.2.0, and is **GA as of 0.2.1**.
The policy DSL stays intentionally narrow (visibility-list
semantics only); the audit-log shape and the principal CRUD surface
are stable across minor releases. New primitives (rich predicates,
RLAC on other resource kinds) layer on top without breaking either.

**0.5.0** extends enforcement from the REST read routes to **agent
retrieval** and the **chunk-listing** route, stamps a `visible_to` key
on every chunk at ingest (so the policy filter pushes down into the
vector query), re-tags existing chunks when RLAC is enabled, and ships
the admin UI (access-control toggle, Principals, Policy audit).

## What it does

When RLAC is enabled on a workspace:

- Every knowledge-base read is filtered by each document's `visible_to`
  list — the REST document + search routes, the chunk-listing route,
  **and agent retrieval**: the built-in `search_kb` / document tools,
  the `astra:data_api` tool, and the MCP `run_agent` / `chat_send` RAG
  path. An agent cannot surface a document its caller can't see.
- The workspace settings page exposes an **Access control** toggle,
  **Principals** management, and a **Policy audit** panel showing every
  decision the policy engine made.
- _(Planned)_ a **View-as** picker (preview the effective view for any
  principal) and a per-document visibility picker on the ingest / edit
  dialogs.

When RLAC is disabled (the default), the workspace behaves exactly
like every prior release: any member sees every document, no row
filter runs, no audit rows are written.

## Enabling

In the web UI:

1. Open **Workspace settings**.
2. Find the **Access control** card.
3. Flip the toggle to **Enabled**.
4. The **Principals** and **Policy audit** sections appear below.

Programmatically:

```bash
curl -X PATCH "$RUNTIME/api/v1/workspaces/$WS" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"rlacEnabled": true}'
```

### Flip-on bootstrap

The first time `rlacEnabled` transitions from `false` to `true`, the
runtime bootstraps the workspace into a usable state so you don't
land in a UX dead-end where the KB is visible but every document
call returns `policy_principal_required`:

- **Default principal with admin bypass.** If the workspace has zero
  principals, a default `admin` principal is created with
  `attributes: { admin: "true" }`. The default policy DSL grants
  universal read access to any principal carrying that attribute, so
  the workspace operator sees every document immediately without
  having to add themselves to each doc's `visible_to`. In the web
  app's auth-disabled posture the API client sends
  `x-view-as-principal: admin` by default on every workspace-scoped
  call, so you see every document immediately; a discreet "view as"
  control on the knowledge-base explorer lets you preview the KB as
  any other principal. (When a bearer token is present the runtime
  derives the principal from the token and this header is ignored.)
  Promote or demote any principal later by toggling the attribute
  via the Principals panel or
  `aiw principal update <id> --attribute admin=true`.
- **Visibility backfill.** Every existing document with a `null`
  `visibleTo` array gets `["*"]`, which the canonical DSL matches
  for any principal. The default is intentionally permissive — you
  flipped RLAC on to **start** authoring policy, not to lock
  yourself out of the data you already have. Tighten by editing
  `visibleTo` per-document afterwards.
- **Chunk re-tag.** RLAC pushes the visibility filter down into the
  vector query, which matches on a `visible_to` key stamped on each
  chunk at ingest. So flip-on also re-stamps every existing chunk
  from its document's (now-settled) `visibleTo` — otherwise chunks
  ingested before they carried visibility would be invisible to every
  principal and an RLAC-on search/agent retrieval would return
  nothing. This runs synchronously in the flip request and is
  idempotent.

Documents with an explicit `visibleTo` (including the empty array,
which is a deliberate "no audience" choice) are left untouched. The
bootstrap is idempotent — re-flipping is a no-op.

> **Upgrading from a pre-0.5.0 runtime with RLAC already enabled.**
> The chunk re-tag runs on the `false → true` transition, so a
> workspace that already had `rlacEnabled: true` before upgrading
> won't have re-tagged chunks. Until its chunks are re-tagged, RLAC-on
> search and agent retrieval return empty for that workspace. Re-tag
> by toggling `rlacEnabled` off then on once after upgrading (the
> flip-on path re-stamps every chunk). A non-blocking
> `rlacChunkSchemaVersion` marker that defers this for very large
> workspaces and removes the manual step is tracked as a follow-up.

From the CLI:

```bash
# List principals in the active workspace
aiw principal list --workspace $WS

# Create a principal with attributes the policy DSL can branch on
aiw principal create alice \
  --label "Alice Lovelace" \
  --attribute dept=engineering \
  --attribute level=L5 \
  --workspace $WS

# Preview a policy DSL fragment against a principal — useful for
# iterating before flipping rlacEnabled
aiw policy preview \
  --dsl "owner_id = \$principal.id OR '*' = ANY(visible_to)" \
  --principal alice \
  --workspace $WS

# Inspect recent RLAC decisions
aiw policy audit --limit 20 --workspace $WS
```

`aiw workspace patch` for flipping `rlacEnabled` from the CLI is a
follow-up.

## Modeling principals + policies

A **principal** is a user, group, or service identity that can be
listed in a document's `visible_to` set. The principal CRUD endpoints
live under `/api/v1/workspaces/{workspaceId}/principals` and the UI
in **Workspace settings → Principals**. The same surface is
available via `aiw principal {list,get,create,update,delete}`.

A **policy** compiles to a predicate that runs at read time. The
runtime exposes a preview endpoint so the UI and CLI can show the
compiled predicate without persisting it:

```
POST /api/v1/workspaces/{workspaceId}/policy/compile-preview
```

The current DSL is intentionally narrow — visibility-list semantics
plus an admin-attribute bypass:

```
$principal.admin = 'true'
  OR current_principal_id() = ANY(visible_to)
  OR '*' = ANY(visible_to)
```

In English: a row is visible if the calling principal carries the
`admin` attribute, OR the principal id is listed in `visible_to`,
OR `'*'` is listed in `visible_to`. The admin clause is evaluated at
compile time against the current principal — for admin-attributed
callers the compiler collapses the whole predicate to "no filter"
(empty Data API filter), so admin reads have no per-row overhead.

Richer primitives (group hierarchies, deny lists, time-bounded
visibility) are tracked in the
[**Roadmap signals**](#roadmap-signals) section below; they layer on
top of the current primitive without changing existing predicates.

## Audit log

Every policy decision emits an entry the UI surfaces in
**Workspace settings → Policy audit** and the CLI surfaces via
`aiw policy audit`.

### Shape — stable as of 0.2.0

```
{
  workspaceId:        string,        // UUID
  auditDay:           "YYYY-MM-DD",
  ts:                 ISO-8601 UTC,  // "…T…Z" with ms precision
  decisionId:         string,        // UUID
  principalId:        string | null, // null when no principal applied
  knowledgeBaseId:    string,        // UUID
  resourceId:         string,        // documentId today
  action:             "list" | "get" | "search" | "ingest" |
                      "update" | "delete",
  decision:           "allow" | "deny" | "filter",
  reason:             string,
  compiledFilterJson: string | null,
}
```

The field set, JSON types, and the `action` / `decision` enum
membership are **stable across minor releases starting with 0.2.0**.
SIEM ingestion and operator alerting can rely on these without
parsing tool-specific reason strings.

**Evolution policy.** Additive changes — new optional fields, new
enum members — are non-breaking and may land in any minor release.
Renaming or removing a field requires a minor-version deprecation
window: the change must be announced under **Changed** in
[`CHANGELOG.md`](../CHANGELOG.md) one minor release before it lands.

For breaking evolutions, the runtime keeps a
[`PolicyAuditRecordV1`](../runtimes/typescript/src/control-plane/types.ts)
alias for the current shape; a future `V2` lands alongside V1 so
integrators can migrate on their own cadence.

The lock is enforced by
[`audit-shape-lock.test.ts`](../runtimes/typescript/tests/policy/audit-shape-lock.test.ts)
— if you add a field to `PolicyAuditRecord`, update the lock test
and the table above in the same PR.

## Scope of this release

The following are intentionally out of scope for the GA surface;
they're tracked as additive follow-ups (see
[Roadmap signals](#roadmap-signals)):

- Documents are the only access-controlled resource *kind*. As of
  0.5.0 a document's visibility is enforced everywhere it's read —
  including agent retrieval — but conversations and agents themselves
  are not row-filtered (RLAC on those resource kinds is a follow-up).
- The visibility list is the only policy primitive shipping. Rich
  predicates (group hierarchies, deny lists, time-bounded visibility)
  are post-0.2.

## Roadmap signals

We're tracking these for the next minor releases (0.3.x and beyond):

- RLAC on conversations + agents.
- Rich predicates (group hierarchies, deny lists, time-bounded
  visibility) layered on top of the current visibility-list primitive.
- Test fixtures + scenarios pinned in `conformance/scenarios.json` so
  Python/Java runtimes can implement the same predicate semantics.

The audit-log shape itself has stabilized as of 0.2 — see the
**Shape — stable as of 0.2.0** subsection above for the contract and
the evolution policy.
