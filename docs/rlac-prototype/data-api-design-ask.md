# Row-Level Access Control — Design Ask to the Data API Team

**Status**: working prototype, merged to main
**Owner**: Eric Hare
**Companion**: Slack thread with Stefano Lottini, 2026-05-14

## TL;DR

The AI Workbench ships a working RLAC story end-to-end:

- **A workspace-level master switch** (`rlac_enabled` on
  `wb_config_workspaces`).
- **Per-row `visible_to` metadata** on every ingested document, set
  by a three-mode picker (**Only You** / **Public** / **Custom**) in
  the SPA's ingest and edit flows.
- **A canonical SQL-subset predicate** that compiles to a Data API
  `filter` JSON and ships on every `find` — including vector search,
  which composes server-side without recall loss.
- **An audit log** of every policy decision, surfaced as a panel in
  workspace settings.

The mechanism works today entirely client-side. Stefano's existing
`filter` parameter combined with vector-search-with-filter is enough.

**The ask is not to add a new filter capability.** It's to
**lift the policy compilation and the filter-injection enforcement
into the Data API**, so an application bug can't bypass it.

## What the prototype demonstrates

1. **The workspace toggle**. A single boolean controls every RLAC
   surface in the SPA *and* gates the enforcer on every backend
   route. Flipping it off short-circuits `buildPolicyContext` to
   return a no-filter decision; flipping it on activates the
   canonical predicate for every KB in the workspace.

2. **Policy DSL** (Postgres-flavored, see
   `runtimes/typescript/src/policy/`):
   ```sql
   current_principal_id() = ANY(visible_to) OR '*' = ANY(visible_to)
   ```
   `current_principal_id()` is the caller's identity, `visible_to`
   is a per-row `SET<TEXT>` column. The canonical pattern matches
   Stefano's Slack design verbatim.

3. **Compiler**: lowers the AST to a Data API filter. The canonical
   pattern emits:
   ```json
   { "$or": [ { "visible_to": "alice" }, { "visible_to": "*" } ] }
   ```
   The compiler resolves `current_principal_id()` and any
   `$principal.<attr>` references to the calling principal's
   attributes at request time. Hand-authored custom DSLs are not
   currently surfaced in the UI (the picker offers Only You /
   Public / Custom-principal-list only), but the compiler supports
   the full DSL grammar and the `POST /policy/compile-preview`
   endpoint exposes it for the Data API team to inspect.

4. **Per-row metadata at ingest**. Every document is written with a
   `visible_to: set<text>` column and an `owner_principal_id`. The
   ingest route defaults `visible_to` to `[creator_principal_id]`
   when the workspace toggle is on; the SPA's picker overrides at
   upload time.

5. **Read-path injection**: on every `list` / `get` / `search`
   against a policy-enabled workspace, the route handler merges the
   compiled filter into the call. Stefano confirmed vector search
   composes with this filter natively, so recall is unaffected. The
   prototype's search route (`POST .../knowledge-bases/{id}/search`)
   `$and`-merges the policy filter into any user-supplied filter
   before dispatching to the driver.

6. **Write-path evaluation**: on `update` / `delete`, the row is
   fetched and the predicate is evaluated in-memory against it.
   Denied mutations return `PolicyDeniedError`, mapped to 403 by
   the route.

7. **Audit**: every decision (allow / deny / filter) is persisted to
   `wb_policy_audit_by_workspace` with the principal, compiled
   filter JSON, action, resource, reason, and timestamp. Drives the
   workbench's Policy audit panel.

8. **Translatability validator**: the policy compile-preview
   endpoint exposes a structured list of constructs that cannot be
   lowered to a Data API filter. This list is the canonical Data
   API ask, captured in code. Today the DSL only fails
   translatability when developers explicitly probe it (the SPA's
   surfaced preset is always the canonical pattern); the validator
   is wired so a future "Custom DSL" UI re-introduction would
   automatically surface the gap to operators.

## What we want from the Data API

In rough priority order:

### 1. Server-side policy storage and enforcement

Today the workbench is the trusted enforcer. Any new code path that
calls `tables.ragDocuments.find()` without going through the
enforcer silently bypasses RLAC. That's a foreseeable bug. We've
already seen the same shape of regression with field-whitelist
patches dropping `policyEnabled` silently — defense in depth would
catch it.

**Ask**: a `CREATE POLICY` / `DROP POLICY` surface on a Data API
collection or table, plus a per-request principal context
(analogous to Postgres's `current_setting('app.user_id')`). Once
the policy is server-side, the workbench compiler becomes purely a
UX affordance — the actual enforcement is in the platform.

### 2. Principal context on the wire

Today the workbench inlines `current_principal_id()` at compile
time, which means **the compiled filter is principal-specific** and
must be re-built per request. If the Data API accepted a
`X-Principal-Id` header (or a token claim it could read), the
workbench could ship a static policy at creation time and let the
server bind the principal.

### 3. Attribute-driven principal references

The DSL supports `$principal.role`, `$principal.dept`, etc., but
the workbench has to resolve them to literals before compiling
because the Data API filter language has no `current_principal`
reference. ABAC policies that use multiple attributes become N
filters, one per attribute combination — workable for the
prototype, awkward at scale.

**Ask**: a way for a filter to reference fields from the request's
principal context, e.g. `{ owner_id: { $eq: { $principal: "id" } } }`.

### 4. Set-membership operators across all find variants

`visible_to` is a `SET<TEXT>` and the canonical pattern relies on
`<scalar> = ANY(set_column)`. Stefano confirmed this works today
via Data API filter equality on a set column. Three extensions
would let richer policies translate cleanly:

   - `$all` over a set column — for `labels @> ARRAY['finance', 'confidential']`.
   - `$any` over a set column with multiple values — for "principal
     has any of {alice, bob, finance-team}".
   - Filter expressions that combine set membership with
     `$or`/`$and` across multiple set columns.

The prototype's compiler emits `{ col: { $all: [...] } }` already;
need confirmation this is supported on every Data API surface
(regular find, vector find, hybrid find).

### 5. Row-to-row comparisons (lower priority)

The validator flags row-to-row comparisons
(`row.parent_id = row.child_id`) as untranslatable. We don't have a
customer asking for these yet, but they're the natural next step
after RBAC/ABAC for hierarchical access models. Not a blocker —
flag for future work.

### 6. Atomic policy + data DDL

The workbench toggle currently does not backfill `visible_to` on
existing documents when RLAC is flipped on. Server-side policy
should ideally apply the predicate **after** any pending DDL/DML
transactions, so toggling policy on never makes data temporarily
unreadable; or at minimum, the platform should support a
backfill primitive (`UPDATE ... WHERE visible_to IS NULL`) that
operators can run in the same transaction as flipping the policy
flag.

## What we are NOT asking for

- **Not** a brand-new filter operator family. The existing operators
  (`$or`, `$eq`, `$in`, `$ne`, `$gt`, `$lt`, `$all`) cover the
  canonical pattern. The ask is enforcement + context propagation,
  not expressiveness.
- **Not** policies that look at fields outside the row (joins,
  lookups, cross-row aggregates). Postgres RLS doesn't allow those
  either; they produce surprising performance characteristics and
  the prototype rejects them at parse time.
- **Not** vector-search-specific extensions. Stefano's design is
  that the same filter mechanism applies pre-ANN, server-side, and
  we've confirmed that suffices.

## Open questions for the Data API team

1. Is there a precedent (or appetite) for a `principal_context`
   request header that the filter language can reference?
2. Can a Data API collection carry a server-side policy DDL, or do
   you prefer that to live in a sidecar service?
3. What's the right TTL/cache story for compiled policies — do you
   recompile every request, or pin the AST?
4. How would you stage a rollout of server-side enforcement across
   the existing fleet without surprising customers whose data
   lacks the `visible_to` column?
5. The workbench currently uses one workspace-wide policy. If the
   Data API moves enforcement server-side, would policy attach
   per-collection, per-keyspace, or per-database?

## Files of interest in the prototype

- **DSL parser / compiler / evaluator / validator**:
  `runtimes/typescript/src/policy/`
- **Route-layer enforcer**:
  `runtimes/typescript/src/policy/enforcer.ts` —
  `buildPolicyContext()` and `assertPolicyAllowsMutation()` are the
  two entrypoints; both take a `workspaceRlacEnabled` boolean.
- **Workspace toggle**:
  `apps/web/src/pages/WorkspaceSettingsPage.tsx` (the
  `AccessControlToggle` component) and the `rlac_enabled` column on
  `wb_config_workspaces`.
- **Per-row schema additions**:
  `runtimes/typescript/src/astra-client/table-definitions.ts`
  (`visible_to`, `owner_principal_id`,
  `wb_principals_by_workspace`, `wb_policy_audit_by_workspace`).
- **Route call sites** that thread the workspace flag:
  `runtimes/typescript/src/routes/api-v1/kb-documents.ts` (list /
  get / create / update / delete / ingest paths) and
  `routes/api-v1/kb-data-plane.ts` (search).
- **Compile-preview surface for inspection**:
  `POST /api/v1/workspaces/{workspaceId}/policy/compile-preview`,
  body `{ "dsl": "...", "principalId": "alice" }`.
- **Tests**:
  - `tests/policy/policy.test.ts` — DSL unit tests
  - `tests/policy/enforcer.integration.test.ts` — end-to-end
  - `tests/policy/routes.test.ts` — HTTP-level
- **Demo seed**:
  `runtimes/typescript/scripts/seed-rlac-demo.ts`
- **Demo walkthrough**:
  `docs/rlac-prototype/demo-script.md`

## Reference: Stefano's Slack reply (2026-05-14)

> Every find, whether vector or not, accepts a filter parameter.
> Say each document (not: chunk, I mean document as seen by user)
> is ingested as either "Public" or "Personal". They get a label
> like `{"visibleTo": "*"}` or `{"visibleTo": "user001"}`. At
> ingestion, this attribute can be reported in all chunks in the
> vector store. Then it will be a job of the (centralized) data
> access layer, whether vector-searching or regular-searching, to
> inject `{"filter": {"$or": [{"visibleTo": "*"}, {"$visibleTo":
> "<caller's user ID>"]}}` in all searches, based on the identity
> of the caller. This layer should ensure no find is executed
> without that addition, and this is it.

The prototype is the workbench-side implementation of exactly this
pattern. The remaining work is moving the "ensure no find is
executed without that addition" guarantee from the workbench's good
behavior to the Data API's contract.
