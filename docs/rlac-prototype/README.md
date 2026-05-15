# RLAC Prototype

Row-Level Access Control for knowledge-base documents in the AI
Workbench. Branch: `feat/rlac-prototype` (now merging into `main`).

This prototype's purpose was to put a **working** RLAC story —
backend enforcement, audit, and a clickable SPA — in front of the
Data API team to drive a server-side enforcement conversation. The
implementation also stands on its own as a usable workbench feature
for any deployment that wants per-document visibility today.

## The model

Access control is a **workspace-wide master switch**. Each workspace
row carries an `rlac_enabled` boolean. When off (the default), no
filtering happens anywhere and the SPA hides every RLAC surface.
When on:

- Every KB read is filtered against each document's `visible_to`
  list using Stefano's canonical predicate
  (`current_principal_id() = ANY(visible_to) OR '*' = ANY(visible_to)`).
- The **View as** picker appears in each KB header (one principal at
  a time).
- The Ingest and Edit-document dialogs offer a three-mode visibility
  picker: **Only You**, **Public**, **Custom**.
- The Documents table shows a `Visible to` column.
- Workspace Settings shows **Principals** and **Policy audit**
  panels.

The model is intentionally binary. Per-KB granularity is parked
("Public Documentation open, HR Policies gated" is a future feature
— the data model still carries per-KB `policyDsl`/`policyEnabled`
columns to make that re-introduction non-breaking).

## Reading order

1. [data-api-design-ask.md](./data-api-design-ask.md) — what we want
   from the Data API team and why.
2. [demo-script.md](./demo-script.md) — 10-minute click-only
   walkthrough for a review meeting.
3. The implementation, in this order:
   - **Policy engine** (`runtimes/typescript/src/policy/`) — DSL
     parser, compiler, evaluator, validator, plus the route-layer
     enforcer that takes a workspace flag and short-circuits when off.
   - **Schema** (`runtimes/typescript/src/astra-client/table-definitions.ts`)
     — new column `rlac_enabled` on `wb_config_workspaces`; new
     tables `wb_principals_by_workspace` and
     `wb_policy_audit_by_workspace`; legacy per-KB columns
     `policy_dsl`/`policy_enabled` retained for future use.
   - **Record types** (`runtimes/typescript/src/control-plane/types.ts`)
     — `WorkspaceRecord.rlacEnabled`, `PrincipalRecord`,
     `PolicyAuditRecord`, plus `visibleTo` and `ownerPrincipalId`
     fields on `RagDocumentRecord`.
   - **Repos**
     (`runtimes/typescript/src/control-plane/repos/principals.ts`,
     `policy-audit.ts`) — workspace-scoped CRUD contracts.
   - **Backend implementations** — memory, file, and Astra (all
     three persist to real storage; Astra writes to
     `wb_principals_by_workspace` and `wb_policy_audit_by_workspace`
     and survives restarts).
   - **Principal-resolver middleware**
     (`runtimes/typescript/src/auth/principal-resolver.ts`) — reads
     the `x-view-as-principal` header in dev mode / bootstrap /
     no-auth-subject paths; resolves OIDC `sub` / API-key label
     otherwise.
   - **Route wiring** (`runtimes/typescript/src/routes/api-v1/`) —
     `kb-documents.ts` (list / get / create / update / delete) and
     `kb-data-plane.ts` (search) call `buildPolicyContext` /
     `assertPolicyAllowsMutation` with the workspace flag.
   - **API routes for RLAC** — `routes/api-v1/principals.ts` (CRUD),
     `routes/api-v1/policy.ts` (compile-preview + audit list).
4. **The SPA**:
   - `apps/web/src/pages/WorkspaceSettingsPage.tsx` — hosts the
     `AccessControlToggle` card; renders Principals + Policy audit
     conditionally.
   - `apps/web/src/components/workspaces/VisibilityPicker.tsx` —
     three-mode picker; locks the current principal in Custom; has a
     "custom-sticky" flag so clicking Custom doesn't snap back to
     Only You.
   - `apps/web/src/components/workspaces/IngestQueueDialog.tsx`,
     `EditDocumentDialog.tsx`, `DocumentDetailDialog.tsx` —
     surface the picker behind `useRlacEnabled(workspace)`.
   - `apps/web/src/components/workspaces/ViewAsPicker.tsx` — header
     chip; auto-defaults to the first principal so the dropdown is
     never empty.
   - `apps/web/src/components/workspaces/PrincipalsPanel.tsx` — list
     / create / edit / delete principals.
   - `apps/web/src/components/workspaces/PolicyAuditPanel.tsx` —
     scrollable, sticky-header audit table.
   - `apps/web/src/hooks/useRlac.ts` — `usePrincipals`,
     `useUpdatePrincipal`, etc., plus the convenience
     `useRlacEnabled(workspace)` selector.
   - `apps/web/src/lib/viewAs.ts` — per-workspace view-as state,
     read directly from localStorage by the API client based on the
     request URL (lifecycle-independent — no React-state race).
5. **Tests**:
   - `runtimes/typescript/tests/policy/policy.test.ts` — DSL parser /
     compiler / validator unit tests.
   - `runtimes/typescript/tests/policy/enforcer.integration.test.ts`
     — end-to-end RLAC against the memory store.
   - `runtimes/typescript/tests/policy/routes.test.ts` — HTTP-level
     route tests (principals, policy compile-preview, doc filter, KB
     search, audit panel).
   - `runtimes/typescript/tests/astra-client/converters.test.ts` —
     Date → ISO coercion for the Astra audit/principal converters.
   - `apps/web/src/lib/api.test.ts` — pins the wire contracts for
     workspace + KB-doc patches and the view-as header derivation
     from the request path.
6. **Seed/demo script**:
   `runtimes/typescript/scripts/seed-rlac-demo.ts` runs the full
   flow against a `FileControlPlaneStore`.

## What's wired

| Layer | Status |
|---|---|
| Policy DSL parser / compiler / evaluator / validator | ✅ implemented & tested |
| Astra persistence: `rlac_enabled`, principals, audit | ✅ real tables + additive-column migrations |
| Memory + file backends | ✅ implemented |
| Route-layer enforcer (list / get / create / update / delete / search) | ✅ tested via integration + route tests |
| Per-workspace master switch (Workspace Settings) | ✅ click-only |
| Principal CRUD (UI + API) | ✅ click-only |
| Visibility picker (Only You / Public / Custom) on ingest + edit | ✅ click-only |
| View-as picker in KB header | ✅ click-only |
| Policy audit panel | ✅ scrollable + sticky-header, refreshes every 5s |
| Custom-DSL editor with compiled-filter preview + translatability report | ⚠️ removed from UI (per simplification); component code deleted. Backend compiler still exposed via `POST /policy/compile-preview` |
| Per-KB Access Control toggle | ⚠️ removed from UI (workspace master switch replaces it) |
| Backfill script for legacy docs | ⚠️ present but not driven by UI; `runtimes/typescript/scripts/backfill-rlac.ts` |
| Documentation of design ask | ✅ [data-api-design-ask.md](./data-api-design-ask.md) |

## Running locally

```bash
# From the repo root
npm run dev:web     # SPA on :5173
npm run dev         # backend on :8080
```

`WB_DEV_MODE` is not required. The principal-resolver middleware
honors the `x-view-as-principal` header automatically when the
workspace auth mode is `disabled` (the default dev posture).

Then open <http://localhost:5173>, go to a workspace, **Settings** →
flip on **Access control**, and follow
[demo-script.md](./demo-script.md).

## Astra-side schema impact

Three migrations land when an operator first boots a workbench with
this branch against an existing Astra deployment. They're additive
and idempotent:

| Migration | Owner table |
|---|---|
| New column `rlac_enabled` (boolean) | `wb_config_workspaces` |
| New columns `policy_dsl` (text) + `policy_enabled` (boolean) | `wb_config_knowledge_bases_by_workspace` (currently unused; reserved for future per-KB customization) |
| New columns `visible_to` (set<text>) + `owner_principal_id` (text) | `wb_rag_documents_by_knowledge_base` |
| New table `wb_principals_by_workspace` | — |
| New table `wb_policy_audit_by_workspace` | — |

Existing rows back-compat to safe defaults (`rlac_enabled: false`,
`visible_to: null`, `owner_principal_id: null`). Toggling RLAC on
for a workspace with legacy documents doesn't backfill them — they
remain in their pre-RLAC state. The `scripts/backfill-rlac.ts`
script can mass-assign `visible_to = ["admin"]` to legacy rows if
needed.

## What's parked as follow-up

- **Per-KB customization** (mixed open/gated KBs in one workspace).
- **ABAC-by-attribute presets** (a "Visible to anyone in dept X"
  preset surfaced from `$principal.dept`). DSL already supports
  attribute references; just no UI affordance.
- **Renaming a principal in-place** (cascades `visible_to`
  references across docs). Currently delete + recreate.
- **Search-from-the-UI** (a "search this KB as Alice" affordance).
  Search currently runs through chat/agents; the audit panel picks
  up search decisions when a chat query runs.
- **Per-principal vector indexes** — confirmed NOT needed (Stefano's
  filter composes with `$vector` server-side).
