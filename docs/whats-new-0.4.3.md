# What's new in AI Workbench 0.4.3

0.4.3 stays on the hardening-and-correctness theme of the 0.4.x line. There is
**no HTTP wire-contract change** and **no data migration** — it finishes the
control-plane delete cascade, makes that cascade self-healing on Astra, locks
down the setup/rescue surface, and keeps secrets out of structured logs.

## Workspace deletion is now complete — and self-healing

Deleting a workspace is supposed to take its dependent records with it. Three
child collections were quietly left behind: a workspace's **MCP servers**, its
**access principals**, and its **policy-audit** rows.

0.4.3 closes that on **every** backend — memory, file, SQLite, and Astra:

- **MCP servers** and **principals** are removed with the workspace.
- **Policy-audit rows are purged, not retained.** Those rows are only readable
  through their workspace; once the workspace is gone they are unreachable, so
  keeping them would strand inaccessible data rather than preserve an audit
  trail. (The audit panel is a demo surface, not a compliance store.)

On the Astra backend the cascade is also **self-healing**:

- Children are deleted **first**, the workspace row **last**. If a delete is
  interrupted partway, the workspace row stays in place and the call returns
  `500 cascade_incomplete` (a new error code) rather than reporting success over
  a half-deleted workspace.
- The cascade is **idempotent**, so simply retrying the delete finishes the job.
- A new **orphan reconciler** can sweep up dangling child rows left by older
  versions or past partial failures. It is opt-in:

  ```yaml
  controlPlane:
    reconcileOrphansOnStart: true
  ```

  When enabled, the runtime scans for orphaned child rows at startup and removes
  them. It is off by default — turn it on once after upgrading a long-lived
  Astra deployment, then leave it on or off as you prefer.

## Secrets stay out of your logs

The structured logger now **redacts secret- and token-shaped values** before
they reach log output. API keys, bootstrap tokens, and similar credentials no
longer slip into the logs you ship to an aggregator, even when they appear in a
request payload or error context.

## A tighter setup & rescue surface

The first-run setup and rescue endpoints sit in front of authentication by
necessity — they exist to bootstrap a fresh instance. 0.4.3 tightens them:

- **Every state-changing setup/rescue route now sits behind the setup
  auth-gate.** Read-only status stays open; mutations do not.
- **The bootstrap-token comparison is constant-time.** A timing-safe compare
  removes a side channel that could let an attacker guess the token byte by
  byte.

## Steadier under load and during restarts

A few reliability fixes round out the release:

- **`/readyz` is bounded by a deadline.** A slow or stuck dependency can no
  longer hang the readiness probe — it fails within a bounded window instead of
  hanging your load balancer's health check.
- **Chat requests carry a timeout**, so a wedged upstream provider can't hold a
  request open indefinitely.
- **The web app guards against a malformed JSON response** instead of throwing,
  so a bad gateway reply surfaces as a clean error rather than a blank crash.
- **Agent prompt assembly reads bounded history.** Long, tool-heavy
  conversations no longer re-scan the entire transcript on every turn.

## Under the hood

- **Unified RLAC defaulting.** Row-level access-control defaults now flow
  through a single `resolveRlacDefaults` path — a document's owner defaults are
  applied independently of `visibleTo`. Authorization behaviour is unchanged
  (security-reviewed); this removes a divergent code path, not a rule.
- **Continued modularization sweep.** Large modules keep getting split — the
  multipart ingest parser and the Playground code generation each moved into
  their own tested modules. No behaviour change.
- **The job-progress SSE endpoint is now in the OpenAPI document.**
  `GET .../jobs/{jobId}/events` was always served but absent from
  `/api/v1/openapi.json`, so it never showed up in the generated client types.
  It is now part of the machine-readable contract — params, the `Last-Event-ID`
  resume header, and the `text/event-stream` response — so anything generated
  from the spec covers async-progress streaming.
- **Release-pipeline hardening.** Every GitHub Action in the release workflow is
  pinned to a full commit SHA, and each job runs with least-privilege
  permissions so only the jobs that publish can write to GHCR or cut a Release.
