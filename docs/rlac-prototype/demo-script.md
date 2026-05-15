# RLAC Prototype — Demo Script

A 10-minute walkthrough for the Data API team meeting. Every step is
click-only. Companion to
[data-api-design-ask.md](./data-api-design-ask.md).

## What you should have ready

| | |
|---|---|
| **Backend** | `npm run dev` on :8080 |
| **Frontend** | `npm run dev:web` on :5173 |
| **A workspace** | Any kind. Astra is what we usually demo. |
| **Three small files** | `public-handbook.md`, `alice-private-notes.md`, `bob-private-notes.md` on the desktop. Any short text. |

`WB_DEV_MODE` is not required — the principal-resolver middleware
honors the `x-view-as-principal` header automatically when the
workspace's auth mode is `disabled` (the default dev posture).

## The model

Access control is a **workspace-wide master switch**. Off by default.
When on:

- Every KB read is filtered against each document's `visible_to` list
  via Stefano's canonical predicate.
- The **View as** picker appears in every KB header.
- Visibility pickers appear in the **Ingest** and **Edit document**
  dialogs.
- **Principals** and **Policy audit** panels appear in Workspace
  Settings.
- The `visible_to` column appears in the documents table.

When off, every operator sees every document. No filtering, no audit,
no UI clutter.

---

## The 10-minute demo

### Step 1 — Open Workspace Settings (15s)

Click your workspace → **Settings** in the top right. Scroll past
**API keys**. Notice: there is no Principals panel, no Audit panel,
no RLAC UI of any kind. Just the **Access control** card with a
disabled checkbox.

### Step 2 — Flip Access control on (15s)

☑️ the checkbox in the **Access control** card. Toast: "Access
control enabled."

The page reflows. Two new cards appear: **Principals** and **Policy
audit**.

> Talking point: this is a single PATCH on the workspace row
> (`rlacEnabled: true`). One field, one switch. Every other RLAC
> affordance in the SPA — and every backend enforcement path —
> derives from this boolean.

### Step 3 — Seed three principals (1 min)

In the **Principals** panel, click **New principal** three times:

| Principal id | Label | Attributes |
|---|---|---|
| `alice` | Alice | `role=viewer` |
| `bob` | Bob | `role=viewer` |
| `admin` | Admin | `role=admin` |

Glance at **Policy audit** below — empty for now. "We'll come back
here at the end."

> Talking point: principals are sub-workspace identities. The
> backend stores them in `wb_principals_by_workspace` on Astra —
> survives runtime restarts.

### Step 4 — Open a KB. Documents are the headline (15s)

Back to workspace landing → click a knowledge base.

The page is **the documents table**, plus a header bar with the
amber **View as** chip (showing Alice or whichever principal you
picked first), **Refresh**, and **Ingest**. The View-as chip
appeared *because* the workspace toggle is on. No per-KB toggle, no
policy editor — just docs.

### Step 5 — Ingest with the visibility picker (2.5 min)

Click **Ingest**. The dialog now has a **Visible to** card below the
drop zone (it's there because workspace RLAC is on).

The picker has three modes: **Only You**, **Public**, **Custom**.
"Only You" is pre-selected — resolves to whoever the View-as chip is
on right now.

**File 1, public**: drag `public-handbook.md`. Click **Public**.
Helper: "Every principal in this workspace can read these documents."
**Start ingest**.

**File 2, alice-only**: open Ingest again, drag
`alice-private-notes.md`. With View-as set to Alice, "Only You" is
already the right choice. **Start ingest**.

**File 3, bob-only**: switch the **View as** chip to Bob. Open
Ingest, drag `bob-private-notes.md`. "Only You" now resolves to Bob.
**Start ingest**.

> Talking point: the picker writes `visibleTo` on the document row
> at ingest time. The chip strip in Custom mode pins the current
> View-as principal so you can't lock yourself out of your own
> upload.

### Step 6 — Flip the View-as picker (2 min)

In the KB Explorer header, the amber **View as** chip is currently
set to Bob (from the last ingest). The Documents table shows the
three files with their `visible_to` chips:

| Name | Visible to |
|---|---|
| `public-handbook.md` | `*` (green) |
| `alice-private-notes.md` | `alice` |
| `bob-private-notes.md` | `bob` |

Wait — Bob's view should already have hidden `alice-private-notes.md`.
Flip the picker:

- **Alice**: table refetches. `bob-private-notes.md` disappears.
- **Bob**: refetches. Bob sees public + his notes.
- **Admin**: only the public doc. No implicit bypass — admin is just
  another principal.

> Talking point: the SPA sends every request with
> `x-view-as-principal: <id>`. The route layer compiles the policy
> against that principal, the compiled filter goes to the Data API,
> the Data API returns only the rows that match. **No
> post-filtering** — the filter rides along with the vector sort.

### Step 7 — Edit visibility on an existing doc (1 min)

Set **View as → Alice**. Click the pencil icon on
`alice-private-notes.md`'s row → **Edit document** opens.

The dialog has:
- A **Name** input (rename in place).
- A **Visible to** picker pre-set to Alice (Only You, because that's
  who you're viewing as).
- A **Replace contents…** button to swap the file bytes.

Click **Custom**. The chip strip appears with Alice locked-on (the
chip has a 🔒 icon and is non-clickable — you can't accidentally
remove yourself). Click `bob`. Click **Save changes**.

Flip **View as → Bob**. Bob now sees `alice-private-notes.md` —
without re-uploading. The chip in the column shows both names.

### Step 8 — Policy audit (45s)

Back to Workspace Settings → **Policy audit** card (scrollable,
sticky header):

| When | Principal | Action | Decision | Resource | Reason |
|---|---|---|---|---|---|
| 11:32:14 | bob | list | **filter** | list | filter injected |
| 11:32:11 | alice | list | **filter** | list | filter injected |
| 11:32:02 | alice | update | **allow** | <doc id> | predicate matched |
| 11:31:58 | <none> | list | **deny** | list | no principal context |

Refreshes every 5 seconds. Persisted in
`wb_policy_audit_by_workspace`.

> Talking point: this entire history was empty 10 minutes ago. Every
> decision the runtime made — read filters, write authorizations,
> denials — is recorded with the compiled filter JSON intact.

### Step 9 — Flip Access control off (15s) *(optional, to drive the point home)*

Back to Settings → uncheck **Access control**. The Principals card
disappears. The Audit card disappears.

Open the KB explorer. The View-as chip is gone. The `visible_to`
column is gone. The Ingest dialog's visibility picker is gone.

> Talking point: one workspace-level boolean. The SPA hides every
> RLAC surface; the backend short-circuits every enforcer call. No
> half-on states, no per-KB drift.

Flip the toggle back on before closing.

### Step 10 — The design ask (1.5 min, the closer)

Pull up [data-api-design-ask.md](./data-api-design-ask.md), sections
1–4:

1. **Server-side policy storage and enforcement.** Today the
   workbench is the trusted enforcer — every route has to remember
   to call `buildPolicyContext`. We want a `CREATE POLICY` on the
   collection so this stops being our problem.
2. **Principal context on the wire.** The workbench inlines
   `current_principal_id()` per request. An `X-Principal-Id` header
   the filter could reference would let policies be static.
3. **Attribute-driven principal references.** `$principal.role`,
   `$principal.dept` resolve at compile time. Server-side principal
   lookup is the natural next ABAC step.
4. **Set operators across find variants.** Confirm `$all` /
   `$in` / set membership work on regular, vector, and hybrid finds.

The workspace-level master switch is the **user-facing receipt** that
we've boiled this down to one decision: do you want RLAC, yes or no?
The Data API ask is to make that decision enforceable at the
platform layer.

---

## What this demo does **not** require

No DevTools console, no curl, no manual document seeding. Every state
change is a click in the SPA. The only setup outside the browser is
the two dev servers and three small text files on the desktop.

## What's parked as follow-up

- **Per-KB granularity**: removed for now — every KB in a workspace
  shares the same policy. If a customer wants "Public Documentation
  open, HR Policies gated," that's a future feature.
- **Search-from-the-UI**: search runs through chat/agents, not a
  dedicated input on the KB page. The audit table picks up search
  decisions when a chat query runs.
- **ABAC-by-attribute**: the DSL supports `$principal.<attr>` lookups
  internally, but no UI surfaces it. Once principals carry real
  attributes (department, clearance, etc.) we add the attribute-based
  preset.
- **Per-principal vector indexes**: not needed — Stefano's filter
  composes with `$vector` server-side. Called out in
  [data-api-design-ask.md](./data-api-design-ask.md) as a non-goal.
