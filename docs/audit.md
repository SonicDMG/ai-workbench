# Audit logging

The TypeScript runtime emits **structured audit events** for the
sensitive operations listed below. Events are pino log lines at
`info` level with a stable discriminator field `audit: true`, so
deployments can route them to a dedicated sink (file, syslog, SIEM)
by filter.

```jsonc
{
  "level": 30,
  "time": 1735603200000,
  "audit": true,
  "action": "api_key.create",
  "outcome": "success",
  "requestId": "01JFE5...",
  "subject": {
    "type": "oidc",            // "apiKey" | "oidc" | "bootstrap" | "anonymous"
    "id": "sub-123",
    "label": "alice@example.com"
  },
  "workspaceId": "ws-1",
  "details": { "keyId": "...", "label": "ci-deployer" },
  "msg": "audit api_key.create success"
}
```

## What gets logged

| Action | Trigger | Notes |
|---|---|---|
| `api_key.create` | `POST /api/v1/workspaces/{w}/api-keys` | Plaintext is **never** logged. Only `keyId` + caller-supplied `label`. |
| `api_key.revoke` | `DELETE /api/v1/workspaces/{w}/api-keys/{keyId}` | Soft revoke; emitted on the first revoke only. |
| `workspace.create` | `POST /api/v1/workspaces` | Includes the workspace `label` (the human-friendly `name`). |
| `workspace.delete` | `DELETE /api/v1/workspaces/{w}` | Emitted **after** the cascade completes. |
| `auth.login` | OIDC `/auth/callback` | `outcome: "success"` once the access token passes the runtime's own verifier; `outcome: "failure"` with `reason` on token-validation errors. |
| `auth.refresh` | OIDC `/auth/refresh` | Successful silent refresh. Failure paths log a warn line (no audit event yet — feedback wanted). |
| `auth.logout` | OIDC `/auth/logout` | Emitted on every cookie clear, even when no session was present. |

The set is intentionally small. Adding a new event is a one-line
call from a route handler — see
[`src/lib/audit.ts`](../runtimes/typescript/src/lib/audit.ts).

## Sample envelopes

Concrete payloads from a live runtime, lightly redacted. Field order
is `audit, action, outcome, requestId, subject, workspaceId, details,
msg` — pino emits in declaration order, which makes the envelope
stable enough to grep with cut/jq.

### `workspace.create` — anonymous in dev mode

```jsonc
{
  "level": 30,
  "time": 1735603195123,
  "audit": true,
  "action": "workspace.create",
  "outcome": "success",
  "requestId": "01KQG3MCDGC3VWP07BNQWX7NPB",
  "subject": {
    "type": "anonymous",
    "id": null,
    "label": null
  },
  "workspaceId": "ab907991-dba4-4d9d-81f0-4756ec5ccf43",
  "details": { "label": "support-docs" },
  "msg": "audit workspace.create success"
}
```

`subject.type: "anonymous"` is normal in development (default
`auth.mode: disabled`). In production, `subject.type` will be
`"apiKey"` or `"oidc"` — the [auth deployment guard](../runtimes/typescript/src/auth/deployment-guard.ts)
refuses to start with anonymous access on a non-memory control plane.

### `auth.login` — failed JWT validation

```jsonc
{
  "level": 30,
  "time": 1735603612877,
  "audit": true,
  "action": "auth.login",
  "outcome": "failure",
  "requestId": "01KQG3PV9ZH7T82R4KAE8WBN3X",
  "subject": {
    "type": "anonymous",
    "id": null,
    "label": null
  },
  "details": { "scheme": "oidc", "reason": "audience_mismatch" },
  "msg": "audit auth.login failure"
}
```

`workspaceId` is absent because the request never resolves a
workspace before the auth middleware rejects it. `details.reason`
is one of the verifier's terminal error codes (`audience_mismatch`,
`signature_invalid`, `token_expired`, `issuer_mismatch`,
`malformed`); see `src/auth/oidc/verifier.ts`.

### `api_key.create` — authenticated by an OIDC subject

```jsonc
{
  "level": 30,
  "time": 1735603889104,
  "audit": true,
  "action": "api_key.create",
  "outcome": "success",
  "requestId": "01KQG3QRVF20YGD6MTFB8KKCN5",
  "subject": {
    "type": "oidc",
    "id": "auth0|7c2d4f12",
    "label": "alice@example.com"
  },
  "workspaceId": "ab907991-dba4-4d9d-81f0-4756ec5ccf43",
  "details": { "keyId": "3a4977c8-3e01-4fd0-9b02-2e082950bd40", "label": "ci-deployer" },
  "msg": "audit api_key.create success"
}
```

The plaintext token (`wb_live_…`) is **only** in the HTTP response
body, never the audit log. `details.keyId` is the row id; `label` is
the operator-supplied tag.

### Seed-failure events (non-route)

Workspace creation tries to seed default agents, LLM services,
chunking services, and embedding services. Per-row failures emit
`audit: true` error lines (not routed through `audit()` because they
don't cleanly fit `<resource>.<verb>`):

```jsonc
{
  "level": 50,
  "time": 1735603195310,
  "audit": true,
  "workspaceId": "ab907991-dba4-4d9d-81f0-4756ec5ccf43",
  "serviceName": "openai-text-embedding-3-small",
  "err": { "type": "ControlPlaneConflictError", "message": "..." },
  "msg": "failed to seed default embedding service"
}
```

When *every* seed of a kind fails (systemic — DB outage, broken
config), an aggregate line follows with `expected: <count>` so
monitoring can alert on "workspace shipped with no embedders" rather
than counting individual failures.

## Design rules

The audit module enforces a few rules so events stay safe to ship to
external systems:

- **No secret material.** The `details` field is typed and only
  accepts a known set of identifier fields (`keyId`,
  `knowledgeBaseId`, `scheme`, `reason`, `label`). Plaintext tokens,
  refresh tokens, hashes, OAuth codes, and PII are not part of the
  contract and have no path into the envelope.
- **Stable action names.** `<resource>.<verb>` in snake_case. We
  never rename in place — adding a new action and keeping the old
  one for a release is the migration path.
- **Outcome is always set.** `success` | `failure` | `denied` so
  SIEM rules can alert on bursts of `denied` without parsing status
  codes.
- **Best-effort.** Audit logging must never break the request path.
  Logger errors are swallowed inside `audit()`.

## Operating it

- **Single-replica.** The default pino transport writes to stdout.
  Pipe the container's stdout into your log pipeline and filter on
  `audit: true`.
- **Multi-replica.** Each replica writes its own events; correlate
  by `requestId` (already echoed in every audit envelope) and by the
  `Strict-Transport-Security` / `replicaId` markers documented in
  [production.md](./production.md).
- **Retention.** The runtime does **not** retain audit events
  itself. Choose a retention period that satisfies your compliance
  posture and configure it on the sink.

## What's not yet logged

These are tracked as gaps:

- Bootstrap-token use (`auth.bootstrap_use`) — action name is
  reserved in the type but no call site yet.
- Knowledge-base create/delete (`knowledge_base.create` /
  `knowledge_base.delete`) — reserved.
- Failed auth attempts on `/api/v1/*` (the middleware short-circuits
  before reaching a handler). Rate-limit denials are visible from
  the limiter's existing log lines but are not audit events yet.
- Document and chunk mutation. Volume-sensitive; needs a sampling /
  batching strategy first.

PRs welcome.
