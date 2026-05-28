# RLAC on Documents

Row-Level Access Control on Documents landed as a prototype in
[#237](https://github.com/datastax/ai-workbench/pull/237), was
labeled Preview through 0.1.x and 0.2.0, and is **GA as of 0.2.1**.
The policy DSL stays intentionally narrow (visibility-list
semantics only); the audit-log shape and the principal CRUD surface
are stable across minor releases. New primitives (rich predicates,
RLAC on other resource kinds) layer on top without breaking either.

## What it does

When RLAC is enabled on a workspace:

- Every KB read goes through a row-filter built from each document's
  `visible_to` list.
- The KB explorer header and the ingest dialog grow a **View-as**
  picker so operators can preview the effective view for any principal.
- The workspace settings page exposes **Principals** management
  (people + groups) and a **Policy audit** panel showing every
  decision the policy engine made.

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
  having to add themselves to each doc's `visible_to`. The View-as
  picker auto-selects the first principal alphabetically, so the
  next render sends `x-view-as-principal: admin` on every API call.
  Promote or demote any principal later by toggling the attribute
  via the Principals panel or
  `aiw principal update <id> --attribute admin=true`.
- **Visibility backfill.** Every existing document with a `null`
  `visibleTo` array gets `["*"]`, which the canonical DSL matches
  for any principal. The default is intentionally permissive — you
  flipped RLAC on to **start** authoring policy, not to lock
  yourself out of the data you already have. Tighten by editing
  `visibleTo` per-document afterwards.

Documents with an explicit `visibleTo` (including the empty array,
which is a deliberate "no audience" choice) are left untouched. The
bootstrap is idempotent — re-flipping is a no-op.

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

- Only applies to Documents. Agents, conversations, and other
  resources are not row-filtered.
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
