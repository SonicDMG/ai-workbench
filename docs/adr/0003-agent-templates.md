# ADR 0003 — Agent template catalog

- **Status:** Accepted (2026-05)
- **Supersedes:** —
- **Superseded by:** —

## Context

Every freshly created workspace gets two starter agents — Bobby ("no-
nonsense data analyst") and Heidi ("friendly little ghost") — auto-
seeded by [`seedDefaultAgents`](../../runtimes/typescript/src/routes/api-v1/workspaces.ts)
at workspace POST time. The seed list is hard-coded as
`DEFAULT_WORKSPACE_AGENTS` in
[`control-plane/defaults.ts`](../../runtimes/typescript/src/control-plane/defaults.ts).
This shipped late-April-2026 after the original singleton-Bobbie
auto-provisioner was retired.

Two problems with the current shape:

1. **The seeded value is invisible.** A user creates a workspace and
   lands on the workspace detail page; there is no UI hint that the
   chat tab already has two agents waiting. The product is paying
   the cognitive cost of two well-tuned personas and getting near-
   zero credit for them. UX review (May 2026) flagged this as the
   single highest-leverage change in the chat funnel.
2. **The seed list cannot grow without bloating every workspace.**
   Adding a third or fourth persona to `DEFAULT_WORKSPACE_AGENTS`
   means every new workspace ships with N agents whether the user
   wants them or not. The agent picker becomes noisy fast.

Adjacent constraint: existing API clients (and the conformance
fixture for workspace-create) rely on the current "two agents seeded
on POST" behavior. Changing the default-on set is a breaking change
to the wire contract.

The alternatives considered:

1. **Status quo + better UI surfacing only.** Show "We pre-loaded
   Bobby and Heidi" on the workspace page. Cheap, but doesn't solve
   problem (2) — still cannot grow the catalog without forcing every
   new workspace to inherit it.
2. **Optional `templateIds` on the workspace-create body.** Default
   to `["bobby", "heidi"]` if omitted, accept any subset (or empty)
   if provided. Solves the bloat problem at create time but offers
   no path for adding a templated agent to an existing workspace
   (which the UX review's "+ from template" affordance requires).
3. **Template catalog + `from-template` endpoint (chosen).** A
   first-class `AgentTemplate` resource exposed via
   `GET /api/v1/agent-templates` (workspace-independent — templates
   are static catalog data, not per-workspace records). A
   `POST /api/v1/workspaces/{w}/agents/from-template` instantiates a
   chosen template into an agent. The workspace POST handler keeps
   its current default-seed behavior by calling the same template-
   instantiation path internally with a hard-coded default-on set.

## Decision

Introduce an `AgentTemplate` catalog as static runtime data, expose
it via `GET /api/v1/agent-templates`, and add
`POST /api/v1/workspaces/{w}/agents/from-template` for instantiating
a single template into a workspace agent.

- The catalog lives in
  [`control-plane/agent-templates.ts`](../../runtimes/typescript/src/control-plane/agent-templates.ts)
  as a frozen array, indexed by stable `templateId` slug. v1 ships
  with five entries: `bobby`, `heidi`, `maven`, `quill`, `sage`.
- Each template carries `templateId`, `name`, `description`,
  `systemPrompt`, `defaultOnNewWorkspace: boolean`. v1 marks `bobby`
  and `heidi` as default-on; the other three are opt-in.
- `seedDefaultAgents` (workspace POST) now calls
  `instantiateAgentTemplate()` with the catalog filtered by
  `defaultOnNewWorkspace === true`. The wire-level effect on
  workspace POST is unchanged — Bobby and Heidi still appear in the
  seeded agent list — so no API client breaks.
- `from-template` is a thin convenience over `createAgent`. It is
  not the only way to create a templated agent (a UI can also read
  the catalog and POST to plain `createAgent` with a pre-filled
  body), but the dedicated endpoint keeps the "single click → new
  agent" path on one round trip and one audit event.

This is purely additive at the HTTP boundary. The
`ControlPlaneStore` interface and the agent record shape are not
touched.

## Consequences

**Easier:**

- The UI can render a template gallery in three places (onboarding
  step 3, workspace-detail "+ from template" button, chat zero-
  state) by reading one cached query.
- Adding a sixth or seventh persona is a one-file change with no
  migration: append to the catalog, set `defaultOnNewWorkspace:
  false`, ship.
- Future templating beyond agents (KB-defaults templates,
  conversation-starter templates) has a clear precedent.

**Harder:**

- One more concept (`AgentTemplate`) for new readers of the agent
  surface to absorb. Mitigated by the catalog being static, narrow,
  and documented in [`docs/agents.md`](../agents.md).
- Cross-runtime parity now requires the Python and Java green-box
  scaffolds to ship the same catalog when they leave 501-stub
  status. The catalog is wire-compatible JSON, so this is a copy-
  paste, not a re-derivation.

**Deferred:**

- **User-defined templates.** A workspace-scoped or platform-scoped
  "save this agent as a template" flow is the obvious next step.
  Out of scope for v1 — the static catalog establishes the shape
  first.
- **Template versioning.** v1 templates are content-addressed by
  slug only; if `bobby`'s system prompt is edited in a future PR,
  existing seeded agents are not retroactively updated. The seed
  is a snapshot, not a live binding. Acceptable today; revisit
  when we have evidence operators want updates to flow through.

## References

- UX review (May 2026) — surfaced the invisible-seed and
  catalog-bloat problems together.
- [`docs/agents.md`](../agents.md) — runtime documentation for the
  agent surface; updated alongside this ADR to drop the stale
  singleton-Bobbie historical note.
- [`runtimes/typescript/src/control-plane/defaults.ts`](../../runtimes/typescript/src/control-plane/defaults.ts) —
  `DEFAULT_WORKSPACE_AGENTS` is the pre-ADR seed list, now derived
  from the catalog.
