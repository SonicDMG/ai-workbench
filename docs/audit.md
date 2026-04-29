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
