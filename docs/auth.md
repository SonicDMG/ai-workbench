# Authentication

The `/api/v1/*` surface is protected by a single pluggable
middleware. Operators configure it via the `auth:` block in
`workbench.yaml`; route handlers read the result from the Hono
context.

This doc covers the contract, the threat model, the config, and the
rollout plan. Current status: **Phase 1 — scaffold only**. The
middleware exists, the config is honored, and the default is
still "no auth enforced" so existing workflows keep working.

## Default posture

If you ship nothing new, nothing changes:

```yaml
auth:
  mode: disabled
  anonymousPolicy: allow
```

That's the default. The middleware runs, tags every request
anonymous, and routes behave as before. The runtime is still meant
to sit behind an external auth boundary (reverse proxy / API
gateway) in this mode.

## Configuration

```yaml
auth:
  # disabled | apiKey | oidc | any. Only `disabled` is implemented
  # today; other modes fail loudly at startup with a pointer at the
  # PR that will ship them.
  mode: disabled

  # How to handle requests that arrive without an `Authorization`
  # header.
  #   - allow  : treat as anonymous, let the request through
  #   - reject : respond 401 immediately
  #
  # In `disabled` mode there's nothing to verify against, so
  # `reject` is the only way to force authentication at this phase
  # (useful for CI smoke tests to confirm the middleware is wired).
  anonymousPolicy: allow
```

## Contract

Every `/api/v1/*` request goes through the middleware, which
writes an `AuthContext` onto the Hono context:

```ts
interface AuthContext {
  mode: "disabled" | "apiKey" | "oidc" | "any";
  authenticated: boolean;      // true when a verifier matched
  anonymous: boolean;          // true when no token was presented and policy allowed it
  subject: AuthSubject | null; // the verified principal, if any
}
```

Route handlers read it via `c.get("auth")`. Authorization
enforcement (per-route role checks) is not in this phase — that
lands with RBAC. Today the context is informational.

### Header format

`Authorization: Bearer <token>` (RFC 6750). Any other scheme
returns `401 unauthorized` with `WWW-Authenticate: Bearer`.

### Error envelope

Auth failures use the same canonical envelope as every other
error:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Authorization header is required",
    "requestId": "01HY…"
  }
}
```

| Status | Code | When |
|---|---|---|
| 401 | `unauthorized` | Missing / malformed / invalid / expired token. `WWW-Authenticate: Bearer` set. |
| 403 | `forbidden` | Token was valid but the subject lacks permission for the requested resource. Used by RBAC in a later phase. |

### Operational routes stay open

`/`, `/healthz`, `/readyz`, `/version`, `/docs`, and
`/api/v1/openapi.json` bypass the middleware. Load balancers and
ops tooling always need to reach these.

## Threat model

- **External attackers on the open internet.** The auth boundary
  keeps unauthenticated traffic away from the data plane. Without
  it operators must front the runtime with a proxy that enforces
  auth.
- **Credential leakage in logs / envelopes.** Tokens never appear
  in log output, error messages, or response bodies. `requestId`
  is the only ID that traces a request end-to-end.
- **Timing attacks on token lookup.** Tokens are compared in
  constant time (PR #2's API-key implementation uses bcrypt; OIDC
  uses signature verification).

Out of scope for now:

- **Denial-of-service from high-volume anonymous traffic.** Rate
  limiting is a later concern.
- **Per-operation audit log.** Every auth decision will emit a
  structured log line in a later phase (RBAC PR); today only
  request-level logging exists.

## Rollout plan

| Phase | Ships | Status |
|---|---|---|
| 1 | Middleware, config, `disabled` mode | this PR |
| 2 | `mode: apiKey` — workspace-scoped `wb_live_*` keys, issue/revoke routes, UI | next |
| 3 | `mode: oidc` — JWT verification via JWKS; `any` mode enables both | later |
| 4 | Roles + per-route enforcement; audit logging | later |

Each phase is independently shippable. `disabled` stays the
default until the operator explicitly opts in.

## Key-prefix convention

When PR #2 ships API keys, the tokens will use the
`wb_live_<prefix>_<secret>` shape (similar to Stripe's
`sk_live_*` or GitHub's `ghp_*`). That makes leaked keys
immediately greppable in source control and unlocks public secret-
scanning.
