# RLAC on Documents — Preview

> **Preview feature.** Row-Level Access Control on Documents landed
> as a prototype in [#237](https://github.com/datastax/ai-workbench/pull/237)
> and is labeled **Preview** in 0.1.0. The API and audit-log shapes
> may change before 0.2; do not rely on either staying stable across
> 0.1.x patches.

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
**Workspace settings → Policy audit**. The shape is **not stable** —
in particular, the `decision` field may grow new variants and the
timestamps may shift granularity. Treat this as observational, not as
something to wire alerts against, until it leaves Preview.

## Known limitations in 0.1.0

- Only applies to Documents. Agents, conversations, and other
  resources are not row-filtered.
- The visibility list is the only policy primitive shipping. Rich
  predicates (group hierarchies, deny lists, time-bounded visibility)
  are post-0.1.0.
- Audit log shape may change without a deprecation window during
  Preview.
- No `aiw` CLI helpers for principals or policies in 0.1.0.

## Roadmap signals

We're tracking these for the next minor releases (0.2.x / 0.3.x):

- RLAC on conversations + agents.
- API stability commitment + a deprecation window for the audit log
  shape.
- `aiw principal {list,create,delete}` and `aiw policy preview`
  commands.
- Test fixtures + scenarios pinned in `conformance/scenarios.json` so
  Python/Java runtimes can implement the same predicate semantics.
