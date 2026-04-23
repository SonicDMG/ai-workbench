# Authentication

The `/api/v1/*` surface is protected by a single pluggable
middleware. Operators configure it via the `auth:` block in
`workbench.yaml`; route handlers read the result from the Hono
context.

This doc covers the contract, the threat model, the config, and the
rollout plan. Current status: **Phase 3a — OIDC verifier live**.
Workspace-scoped `wb_live_*` tokens (`mode: apiKey`) and JWT
bearer tokens from an OIDC issuer (`mode: oidc`) are both accepted;
`mode: any` registers both so either shape authenticates. The
default is still `disabled` so existing workflows keep working.

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
  # disabled | apiKey | oidc | any
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

  # Required when mode is `oidc` or `any`. The runtime fetches the
  # issuer's JWKS at startup (via OIDC discovery if jwksUri is null)
  # and verifies every JWT's signature, issuer, audience, exp, and
  # nbf before trusting it.
  oidc:
    issuer: https://idp.example.com
    audience: ai-workbench          # or [a, b, c]
    # jwksUri: null                  # auto-discover from issuer
    # clockToleranceSeconds: 30
    # claims:
    #   subject: sub                 # → AuthSubject.id
    #   label: email                 # → AuthSubject.label
    #   workspaceScopes: wb_workspace_scopes  # array claim → scopes
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

Route handlers read it via `c.get("auth")`. Workspace-scoped
authorization is enforced inside each `/api/v1/workspaces/*`
handler via `assertWorkspaceAccess(c, workspaceId)` — an
authenticated subject whose `workspaceScopes` does not include
the target workspace gets `403 forbidden`. Anonymous and
unscoped subjects pass through (unchanged behavior); `GET
/workspaces` additionally filters its response to the subject's
scopes so scoped callers see only workspaces they can reach.
Per-route role checks (RBAC) land in a later phase.

### Authorization model

| Subject | Can reach |
|---|---|
| anonymous (`anonymousPolicy: allow`) | all workspaces, unchanged |
| authenticated, `workspaceScopes: null` | all workspaces (unscoped — operator/admin tokens will land here in Phase 4) |
| authenticated, `workspaceScopes: [...]` | only workspaces whose uid appears in the list |

A workspace-scoped API key (the only kind the Phase 2 UI issues)
carries exactly the workspace that produced it, so a key minted
in workspace A is a 403 on every route under workspace B.

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
| 403 | `forbidden` | Token was valid but the subject's `workspaceScopes` does not include the target workspace. Also reserved for role-based checks in a later RBAC phase. |

### Operational routes stay open

`/`, `/healthz`, `/readyz`, `/version`, `/docs`, and
`/api/v1/openapi.json` bypass the middleware. Load balancers and
ops tooling always need to reach these, and the Scalar-rendered
reference UI at `/docs` hardcodes the OpenAPI URL — both must
load even when `anonymousPolicy: reject` is set. The middleware
is mounted at `/api/v1/workspaces/*`, not `/api/v1/*`, to make
this behavior explicit.

## UI token flow

The bundled web UI (at `/`) surfaces a **key** menu in the
header. Clicking it opens a dialog where an operator pastes a
`wb_live_*` token; the token is stored in `localStorage` under
`wb_auth_token` and attached as `Authorization: Bearer <token>`
on every `/api/v1/*` fetch.

A `ShieldCheck` icon + the prefix preview (e.g. `wb_live_abc123…`)
shows at a glance which token is active. "Clear" removes it,
after which calls go out unauthenticated — fine when `mode:
disabled` or `anonymousPolicy: allow`, but the UI will start
receiving `401 unauthorized` under strict modes.

**XSS caveat.** `localStorage` is readable by any JS on the
origin. That's acceptable for the self-hosted workbench UI
(whose trust boundary is the runtime's own deployment) but not
for embeds of third-party scripts. Phase 3's OIDC flow will
migrate off paste-a-token onto a proper login with
short-lived, in-memory (or httpOnly-cookie-backed) access
tokens.

## Threat model

- **External attackers on the open internet.** The auth boundary
  keeps unauthenticated traffic away from the data plane. Without
  it operators must front the runtime with a proxy that enforces
  auth.
- **Credential leakage in logs / envelopes.** Tokens never appear
  in log output, error messages, or response bodies. `requestId`
  is the only ID that traces a request end-to-end.
- **Timing attacks on token lookup.** Tokens are compared in
  constant time — the API-key path stores a salted scrypt digest
  (`scrypt$<salt>$<digest>`) and uses `timingSafeEqual`; OIDC
  uses signature verification.

Out of scope for now:

- **Denial-of-service from high-volume anonymous traffic.** Rate
  limiting is a later concern.
- **Per-operation audit log.** Every auth decision will emit a
  structured log line in a later phase (RBAC PR); today only
  request-level logging exists.

## Rollout plan

| Phase | Ships | Status |
|---|---|---|
| 1 | Middleware, config, `disabled` mode | ✅ shipped |
| 2 | `mode: apiKey` — workspace-scoped `wb_live_*` keys, issue/revoke routes, UI | ✅ shipped |
| 3a | `mode: oidc` — JWT verification via JWKS; `any` mode enables both | ✅ shipped |
| 3b | Browser OIDC login flow (PKCE) — replaces paste-a-token with a proper /auth/login redirect + short-lived session | later |
| 4 | Roles + per-route enforcement; audit logging | later |

Each phase is independently shippable. `disabled` stays the
default until the operator explicitly opts in.

## API keys (Phase 2)

**Wire format**: `wb_live_<12-char-prefix>_<32-char-secret>`,
mirroring Stripe (`sk_live_*`) and GitHub (`ghp_*`). The prefix
half is public (logged, indexed), the secret half is never
persisted — only a scrypt-salted digest of the full token is
stored. That makes leaked keys immediately greppable in source
control and unlocks public secret-scanning.

**Routes**:

- `POST /api/v1/workspaces/{w}/api-keys` — body `{label, expiresAt?}`;
  response `{plaintext, key}`. The `plaintext` field is returned
  exactly once and is never retrievable again.
- `GET /api/v1/workspaces/{w}/api-keys` — lists all keys for the
  workspace, including revoked ones (with `revokedAt` populated).
  The `hash` column is never exposed.
- `DELETE /api/v1/workspaces/{w}/api-keys/{keyId}` — soft-revoke.
  Leaves the row visible with `revokedAt` set; next request
  bearing the token gets `401 unauthorized`.

**Storage**: two CQL tables under the Astra control plane —
`wb_api_key_by_workspace` (primary, partitioned by workspace) and
`wb_api_key_lookup` (secondary, partitioned by prefix) so the
verifier resolves a prefix in O(1) without scanning every
workspace's key list on every request. Memory and file backends
keep in-process equivalents.

**Verifier behavior**: the `ApiKeyVerifier` parses the wire shape,
looks up the record by prefix, rejects revoked / expired keys,
and constant-time-compares the stored digest. On success it bumps
`lastUsedAt` as a fire-and-forget so operators can see which keys
are actually in use.

The runtime never auto-creates an initial bootstrap key — that's a
Phase 4 concern. For now, issue the first key while `mode:
disabled` (or `apiKey + anonymousPolicy: allow`), then flip to
strict enforcement.

## OIDC (Phase 3a)

Any OIDC-compliant issuer that publishes a JWKS works. Typical
setups: Auth0, Okta, Keycloak, Azure AD, Google — or a self-hosted
IdP like Dex / Ory Hydra.

**Startup.** When `mode` is `oidc` or `any`, the runtime resolves
the JWKS URL. If `auth.oidc.jwksUri` is set in config it's used
verbatim; otherwise the runtime issues a GET to
`${issuer}/.well-known/openid-configuration` and reads `jwks_uri`
from the response. This happens once at boot; startup fails if
discovery fails. The key set itself is lazy-loaded on the first
verification and rotates automatically when a token's `kid`
doesn't match any cached key.

**Per-request verification.** On every authenticated call the
verifier:

1. Rejects obviously non-JWT tokens (returns `null` so the apiKey
   verifier can try them in `mode: any`).
2. Validates the JWS signature against the JWKS.
3. Validates `iss` exactly matches `auth.oidc.issuer`.
4. Validates `aud` contains one of the configured audiences.
5. Validates `exp` and `nbf` with `clockToleranceSeconds` of skew.
6. Maps the claims onto `AuthSubject` using `auth.oidc.claims`.

Any failure throws `UnauthorizedError` with a short, safe message
(`oidc token has expired`, `signature did not verify`, etc.) — the
raw jose error is never forwarded to clients.

**Workspace authorization.** The `workspaceScopes` claim — an array
of workspace UIDs, or a space-separated string — drives the same
`assertWorkspaceAccess` path that API-key subjects use. Tokens
with the claim set to JSON `null` are treated as unscoped / admin
and may reach any workspace (matches the "operator tokens" escape
hatch described above).

**Example provisioning (Keycloak).** Add a user attribute
`wb_workspace_scopes = ["ws-alice-staging", "ws-alice-prod"]`, add
a "Script" or "Hardcoded attribute" mapper that copies it into the
access-token claim of the same name, and point `auth.oidc.claims.workspaceScopes`
at it. Same pattern applies to any other IdP with attribute-to-claim
mapping.

**`any` mode.** Both verifiers run in one resolver; order is
apiKey → oidc. Each verifier examines the token shape:

- `parseToken()` in the apiKey verifier returns `null` on anything
  that isn't `wb_live_<12>_<32>`, so JWTs skip it.
- `OidcVerifier` tests the token against a `<b64url>.<b64url>.<b64url>`
  regex and returns `null` for anything that doesn't match, so
  `wb_live_*` tokens skip it.

A token that matches neither shape gets a generic 401 `token did
not match any configured auth scheme`.
