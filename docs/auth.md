# Authentication

The `/api/v1/*` surface is protected by a single pluggable
middleware. Operators configure it via the `auth:` block in
`workbench.yaml`; route handlers read the result from the Hono
context.

This doc covers the contract, the threat model, the config, and the
rollout plan. Current status: **Phase 3b — OIDC browser login live**.
Workspace-scoped `wb_live_*` tokens (`mode: apiKey`) and JWT
bearer tokens from an OIDC issuer (`mode: oidc`) are both accepted;
`mode: any` registers both so either shape authenticates. When
`auth.oidc.client` is configured the runtime also hosts an OIDC
authorization-code-with-PKCE login flow for the web UI — no
paste-a-token required. The default is still `disabled` so
existing workflows keep working.

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
| authenticated, `workspaceScopes: null` | all workspaces + platform-level operations (unscoped — operator/admin tokens will land here in Phase 4) |
| authenticated, `workspaceScopes: [...]` | only workspaces whose uid appears in the list; **cannot** create new workspaces |

A workspace-scoped API key (the only kind the Phase 2 UI issues)
carries exactly the workspace that produced it, so a key minted
in workspace A is a 403 on every route under workspace B.

**Platform-level operations.** Creating a new workspace (`POST
/api/v1/workspaces`) isn't tied to any existing workspace, so
`assertWorkspaceAccess` can't gate it. A second helper,
`assertPlatformAccess`, refuses the request when the subject has a
non-null scope list — otherwise a workspace-scoped key could
silently escalate by minting a fresh tenant outside its scope and
operating against it. Anonymous callers and unscoped subjects
(operator tokens) pass through.

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

## UI credential flow

The UI's header `UserMenu` renders one of three things, driven by
`GET /auth/config`:

1. **Signed in (OIDC session)** — the cookie survived a roundtrip
   through `/auth/me`. Shows the user's label + a logout button.
2. **"Log in" button** — `auth.oidc.client` is configured but the
   browser has no (or an expired) session. Clicking redirects to
   `/auth/login?redirect_after=<current>`.
3. **Paste-a-token fallback** — only `mode: apiKey` is configured
   (no OIDC login). Same `TokenMenu` that shipped in Phase 2,
   stores a `wb_live_*` token in `localStorage`, attaches
   `Authorization: Bearer` on every request.

When the UI gets a `401` on an API call and no paste-token is
set, `lib/api.ts` quietly fetches `/auth/config` once — if OIDC
login is on, it redirects to `/auth/login` so the user lands back
where they started after re-authenticating.

### Session cookie mechanics

After a successful `/auth/callback` the runtime sets a cookie
(`wb_session` by default):

- `HttpOnly` so JS can't read it (XSS becomes harder)
- `SameSite=Lax` so top-level navigations through the IdP redirect
  still carry it back, but third-party contexts don't
- `Secure` when the request arrived over HTTPS (honored via
  `X-Forwarded-Proto` when the runtime is behind a TLS proxy)
- `Max-Age` matches the upstream `expires_in` (typically 1 hour)

The cookie value is `<base64url json>.<base64url hmac>`; HMAC uses
a 32-byte key from `auth.oidc.client.sessionSecretRef` (a
`SecretRef`). When unset the runtime generates an ephemeral key at
boot and logs a warning — fine for dev + single-replica, wrong for
anything clustered.

The payload carries the upstream access token verbatim. Auth
middleware promotes a valid cookie into a synthetic
`Authorization: Bearer` header before the resolver runs, so the
same `OidcVerifier` (iss/aud/exp/nbf/signature) validates both
cookie sessions and API-client bearer calls. No second trust
boundary.

### PKCE flow

`/auth/login` picks a fresh 32-byte verifier, derives the
`code_challenge` (SHA-256 + base64url), stashes the verifier +
nonce + sanitized `redirect_after` in a short-TTL in-memory store
keyed by the generated `state`, then 302s to the IdP's
authorization endpoint with PKCE parameters.

`/auth/callback` re-reads the `state`, takes the entry (it's gone
after one use, preventing replay), swaps `code` + `code_verifier`
for tokens at the IdP, self-verifies the resulting access token
through the same `OidcVerifier` the API uses (if it doesn't pass,
the session is rejected — no trusting tokens that couldn't
actually authenticate), signs the cookie, and redirects to
`redirect_after`. `redirect_after` is validated against
`^/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$` and forced to `/` if it's
absolute or protocol-relative — no open-redirect surface.

### XSS caveat (API-key fallback only)

When the UI is running in `mode: apiKey` (no OIDC login), the
paste-a-token path stores the token in `localStorage`, which is
readable by any JS on the origin. That's acceptable for the
self-hosted workbench UI (whose trust boundary is the runtime's
own deployment) but not for pages embedding third-party scripts.
OIDC login (Phase 3b) avoids this because the session cookie is
`HttpOnly`.

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
| 3b | Browser OIDC login flow (PKCE) — replaces paste-a-token with `/auth/{login,callback,me,logout}` + signed session cookie | ✅ shipped |
| 3c | Silent refresh via `refresh_token` grant, so users don't see mid-session re-logins | ✅ shipped |
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

**Storage**: two Data API Tables under the Astra control plane —
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

## Browser login (Phase 3b)

When `auth.oidc.client` is present the runtime mounts five
endpoints that let the bundled web UI drive the standard
[Authorization Code + PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
flow without the operator ever pasting a token:

| Endpoint | Purpose |
|---|---|
| `GET /auth/config` | Tells the UI which credential surfaces are wired up |
| `GET /auth/login` | 302 to the IdP's authorization endpoint; stashes the PKCE verifier + state |
| `GET /auth/callback` | Swaps `code` for tokens, self-verifies, sets the session cookie, redirects |
| `GET /auth/me` | Current authenticated subject, or 401 |
| `POST /auth/logout` | Clears the cookie |

### Configuration

```yaml
auth:
  mode: oidc                  # or `any`
  anonymousPolicy: reject
  oidc:
    issuer: https://login.example.com/realms/workbench
    audience: ai-workbench
    client:
      clientId: ai-workbench-ui
      # clientSecretRef: env:OIDC_CLIENT_SECRET  # omit for public clients
      # redirectPath: /auth/callback
      # postLogoutPath: /
      # scopes: [openid, profile, email]
      # sessionCookieName: wb_session
      sessionSecretRef: env:WB_SESSION_SECRET    # 32+ bytes; HMAC key
```

`redirectPath` must be registered in the IdP's allowed redirect
URIs. Most IdPs take the absolute URL — the runtime derives that
by combining the request host + `X-Forwarded-Proto` with the
configured path.

### Operational notes

- **Single replica for the state store.** The PKCE verifier + state
  live in an in-process map with a 10-minute TTL. If you run N
  replicas behind a load balancer, either pin OAuth state to one
  replica (sticky sessions for `/auth/*`) or replace
  `MemoryPendingLoginStore` with something shared — the seam is
  the `PendingLoginStore` interface.
- **Session key rotation.** Rotate by updating
  `sessionSecretRef` and restarting. Sessions signed with the old
  key stop validating and users re-login. There's no dual-key
  validation period yet.
- **Silent refresh keeps the cookie ahead of the curve (Phase 3c).**
  When the IdP returns a `refresh_token` on the initial code
  exchange, the runtime stores it in the same signed session
  cookie as the access token. The UI calls `POST /auth/refresh`
  (a) on a timer at ~80% of the access-token lifetime, and (b) as
  a fallback when an API call comes back `401`. The runtime
  swaps the refresh token at the IdP, sets a fresh `Set-Cookie`,
  and the UI retries — no browser redirect, no in-flight blip.
  When refresh is unavailable (no `refresh_token`, IdP rejected
  the rotation, or the runtime's verifier rejects the new
  access token) the UI falls through to the login redirect as
  before.
- **Logout does not RP-initiate.** `POST /auth/logout` clears the
  local session cookie but does not redirect through the IdP's
  `end_session_endpoint`. Browsers remain logged in at the IdP
  (intentional for shared-device scenarios — users stay signed
  into Okta even after clicking "Log out" here). RP-initiated
  logout can come in a follow-up.

## Silent refresh (Phase 3c)

The session cookie carries the IdP's `refresh_token` alongside the
access token, both inside the same HMAC-signed payload. That changes
exactly one threat-model line item from before: cookie theft used
to give an attacker the active session until access-token expiry
(typically an hour). With the refresh token in the cookie, theft
gives the attacker a session as long as the IdP's refresh-token
lifetime allows. Two mitigations:

1. **The cookie remains `HttpOnly` + signed**, so JS still can't
   read or forge it. The threat is exfiltration via a network MITM
   or browser compromise, not XSS.
2. **Operators with sensitive deployments can disable refresh**
   simply by setting their IdP's app to *not* issue
   `refresh_token` for browser flows. The runtime degrades
   gracefully: `canRefresh: false` in `/auth/me`, no scheduled
   refresh on the UI side, behavior reverts to Phase 3b
   (re-login on expiry).

### `POST /auth/refresh`

Accepts the session cookie and returns:

```json
{ "ok": true, "expiresAt": 1735689600 }
```

with a fresh `Set-Cookie` carrying the new access token (and any
rotated refresh token). On failure — no cookie, no
`refresh_token` in the payload, IdP rejected the grant, or the
new access token doesn't pass the runtime's own verifier — the
endpoint clears the cookie and returns `401` with one of:
`no_refresh_token`, `refresh_failed`, or `token_validation_failed`.

### `GET /auth/me` additions

```json
{
  "id": "alice",
  "label": "alice@example.com",
  "type": "oidc",
  "workspaceScopes": ["…"],
  "expiresAt": 1735689600,
  "canRefresh": true
}
```

`expiresAt` is read out of the JWT's `exp` claim (the token has
already passed verification at this point — we're not re-validating,
just exposing the value). It's `null` for opaque tokens.
`canRefresh` mirrors whether a `refresh_token` is in the cookie.

### `GET /auth/config` additions

Adds `refreshPath: "/auth/refresh"` (or `null` when login isn't
configured). The UI keys off this to decide whether to schedule
the timer at all.

### UI scheduling

`apps/web/src/hooks/useSession.ts:useSilentRefresh` registers a
single `setTimeout` that fires at ~80% of the access token's
remaining lifetime, clamped to `[30s, 30min]`. On success it
invalidates `["auth", "me"]` so the next render re-reads
`expiresAt` and the loop continues.

`apps/web/src/lib/api.ts:request` runs a single-flight refresh
attempt on any 401: concurrent in-flight queries all wait on the
same `/auth/refresh` call and either retry together or fall
through to the login redirect together.
