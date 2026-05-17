# RLAC on Documents — Preview

> **Preview feature.** Row-Level Access Control on Documents landed
> as a prototype in [#237](https://github.com/datastax/ai-workbench/pull/237)
> and is labeled **Preview** in 0.1.0. The policy DSL is intentionally
> narrow (visibility-list semantics only) and may grow new primitives.
> The **audit-log shape** is now stable as of 0.2.0 — see
> [Audit log → Shape](#shape--stable-as-of-020) below.

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
2. Find the **Access control** card (it has a `Preview` chip).
3. Flip the toggle to **Enabled**.
4. The **Principals** and **Policy audit** sections appear below.

Programmatically:

```bash
curl -X PATCH "$RUNTIME/api/v1/workspaces/$WS" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"rlacEnabled": true}'
```

The CLI doesn't expose `aiw workspace patch` yet — slated for 0.2.

## Modeling principals + policies

A **principal** is a user, group, or service identity that can be
listed in a document's `visible_to` set. The principal CRUD endpoints
live under `/api/v1/workspaces/{workspaceId}/principals` and the UI
in **Workspace settings → Principals**.

A **policy** compiles to a predicate that runs at read time. The
runtime exposes a preview endpoint so the UI can show the predicate
without persisting it:

```
POST /api/v1/workspaces/{workspaceId}/policy/compile-preview
```

The current shape is intentionally narrow — visibility-list semantics
only. The Preview label is partly because a richer DSL is still on
the table and may change input/output shapes in 0.2.

## Audit log

Every policy decision emits an entry the UI surfaces in
**Workspace settings → Policy audit**.

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

## Known limitations

- Only applies to Documents. Agents, conversations, and other
  resources are not row-filtered.
- The visibility list is the only policy primitive shipping. Rich
  predicates (group hierarchies, deny lists, time-bounded visibility)
  are post-0.2.
- No `aiw` CLI helpers for principals or policies yet.

## Roadmap signals

We're tracking these for the next minor releases (0.3.x and beyond):

- RLAC on conversations + agents.
- Rich predicates (group hierarchies, deny lists, time-bounded
  visibility) layered on top of the current visibility-list primitive.
- `aiw principal {list,create,delete}` and `aiw policy preview`
  commands.
- Test fixtures + scenarios pinned in `conformance/scenarios.json` so
  Python/Java runtimes can implement the same predicate semantics.

The audit-log shape itself has stabilized as of 0.2 — see the
**Shape — stable as of 0.2.0** subsection above for the contract and
the evolution policy.
