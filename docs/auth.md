# Authentication

The `/api/v1/*` surface is protected by a single pluggable
middleware. Operators configure it via the `auth:` block in
`workbench.yaml`; route handlers read the result from the Hono
context.

This doc covers the contract, the threat model, the config, and the
rollout plan. Current status: **Phase 3c — OIDC browser login +
silent refresh live**.
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
authorization is enforced by an app-level wrapper around
`/api/v1/workspaces/{workspaceId}/...` routes — an authenticated
subject whose `workspaceScopes` does not include the target
workspace gets `403 forbidden`. Anonymous and unscoped subjects
pass through (unchanged behavior); `GET /workspaces` additionally
filters its response to the subject's scopes so scoped callers see
only workspaces they can reach. Per-route role checks (RBAC) land
in a later phase.

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

### Privilege scopes (coarse tiers + fine grants)

Workspace API keys carry a second axis besides workspace membership:
a privilege-scope list. 0.5.0 refines the three coarse tiers into a
**fine-grained taxonomy** while keeping the coarse tiers as first-class
**supersets**, so existing keys are unaffected.

**Coarse tiers** (aligned with the RBAC roles in `auth/roles.ts` —
`viewer` / `editor` / `admin`):

- **`read`** — list / fetch / search workspace content.
- **`write`** — mutate workspace content (KBs, documents, agents,
  services, ingest).
- **`manage`** — admin-only operations: API keys, RLAC principals +
  policy, and workspace destroy.

**Fine grants** (0.5.0) let an operator mint a narrowly-scoped key:

| Coarse tier | Fine grants | Each fine grant covers |
|---|---|---|
| `read` | `read:content` · `read:chat` · `read:audit` | KB search + document/chunk reads · conversation history · policy-audit log |
| `write` | `write:ingest` · `write:kb` · `write:services` · `write:agents` | ingest + document/record CRUD · KB + knowledge-filter CRUD · execution services + MCP servers · agent CRUD |
| `manage` | `manage:keys` · `manage:access` · `manage:workspace` | mint / revoke API keys · RLAC principals + policy · workspace destroy |
| _(standalone)_ | `tools:invoke` | drive an agent to call external (remote-MCP) tools |

**Containment is the whole design.** A held scope grants a required
scope when they're equal, *or* when the held scope is a coarse tier of
the required fine grant — matched on the `:` boundary, so `write` grants
`write:ingest` but not a sibling like `writeX` (`subjectGrantsScope` in
`auth/roles.ts`; `assertScope` / `requireScope` in `auth/authz.ts` apply
it). Consequences:

- A legacy `["read", "write"]` key still satisfies every `write:*`
  route — **no key minted before 0.5.0 loses access.**
- A narrow `["read", "write:ingest"]` key can ingest but cannot create a
  KB (`write:kb`), administer access (`manage:access`), or mint keys
  (`manage:keys`).
- A fine grant never widens upward: `write:ingest` grants neither coarse
  `write` nor a sibling `write:kb`.

Keys minted before scopes existed back-compat to `["read", "write"]`;
OIDC and bootstrap subjects carry `scopes: null`, which implicitly grants
every scope.

Enforcement resolves a *fine* scope per route and applies it through the
same containment check, so coarse keys keep working:

1. **MCP tool gate** — each write tool requires its fine scope
   (`ingest_text` / `delete_document` → `write:ingest`;
   `create_knowledge_base` / `delete_knowledge_base` → `write:kb`) and
   returns `isError: true` with `outcome: "denied"` for a caller that
   lacks it. See [MCP per-tool scopes](mcp.md#per-tool-scopes).
2. **REST mutation gate** — `mutatingRouteWriteScope()` is mounted on
   every `/api/v1/workspaces/{w}/*` route, right after
   `workspaceRouteAuthz`. The middleware:
   - Lets `GET` / `HEAD` / `OPTIONS` through unconditionally — read
     methods can't mutate.
   - Lets a small allowlist of "POST-as-read" paths through:
     `/test-connection`, `/connect/verify`, `/mcp` (JSON-RPC entry
     point; tool-level scope check handles individual writes),
     `/search` (body-shaped query), and anything under
     `/conversations` (chat session state, mirroring the ungated
     `chat_send` MCP tool — conversations and their messages aren't
     KB content).
   - Maps every other write-shaped request (POST/PATCH/PUT/DELETE) to
     its fine scope via `writeScopeForRoute(path)` — ingest / documents
     / records → `write:ingest`; knowledge-bases + filters → `write:kb`;
     execution services + MCP servers → `write:services`; agents →
     `write:agents`; any unmatched mutating path falls back to coarse
     `write` (the strictly-most-restrictive floor, so a new route can't
     under-gate) — and skips the manage-scoped routes (gated below) so a
     narrow `manage:*` key isn't blocked by the write floor. A key
     lacking the resolved scope gets `403 forbidden` with `message:
     "authenticated subject is missing required scope 'write:ingest'"`
     (or whichever fine scope applied).
3. **REST admin gate** — `manageRouteScope()` maps admin surfaces to
   their fine scope via `manageScopeForRoute(path)`: `…/api-keys` →
   `manage:keys`; `…/principals` and `…/policy` (the entire CRUD
   surface incl. the policy-audit log — listing credentials or
   principals is itself a privileged read) → `manage:access`;
   `DELETE /workspaces/{w}` → `manage:workspace`. A legacy
   `["read", "write", "manage"]` key passes all of them by containment;
   an `editor` (`["read", "write"]`) key still gets `403 forbidden`.
   (The `rlacEnabled` toggle on `PATCH /workspaces/{w}` requires
   `manage:access` in the handler — it shares a route with the
   write-level rename.)

A 403 from a scope gate also carries a structured `requiredScope` field
on its `auth.api_denied` audit row (e.g. `write:ingest`), so compliance
can aggregate denials by scope — see [audit.md](audit.md).

Anonymous callers (when `anonymousPolicy: allow`) and `scopes: null`
subjects bypass every gate — `anonymousPolicy` is the only knob that
decides whether anonymous reaches the route at all, and unscoped
subjects are the operator-key escape hatch.

The gates are mount-based rather than per-route, so a freshly added
mutating route inherits a check automatically — and because
`writeScopeForRoute` defaults unmatched mutating paths to coarse
`write`, that inherited gate is never weaker than before; refine it to a
fine scope once the route's facet is clear. New "POST-as-read" endpoints
add a path suffix to the allowlist instead of editing every call site.

> **Migration (0.5.0).** Fine scopes are **fully additive** — unlike the
> 0.4.0 `manage` split below, no existing key loses any capability. Every
> route maps under the same coarse tier it required in 0.4.x, so a legacy
> `read` / `write` / `manage` key grants the new fine scopes by
> containment. What's *new* is the ability to mint **narrower** keys (an
> ingest-only `["read", "write:ingest"]` key, say — via the create-key
> dialog's "Custom (advanced)" picker or `aiw key create --scope
> write:ingest`) and to drive agents' external-tool calls under a
> dedicated `tools:invoke` grant. Deliberate notes: **chat send stays
> ungated** (the `…/conversations` routes remain in the read-shaped
> allowlist, so a read-only key can still chat); `write:agents` is
> reserved for **agent CRUD**, not chat. The policy-audit log stays
> admin-gated (`manage:access`); `read:audit` is defined in the taxonomy
> but not yet bound to a route.

> **Migration (0.4.0).** Splitting `manage` out of `write` is a
> deliberate behavior change: an existing `["read", "write"]` key that
> previously issued API keys, administered RLAC, or deleted a
> workspace now gets `403 forbidden` on those routes. Re-mint the key
> with `manage` (or use an OIDC admin / bootstrap token) to restore the
> old capability. Content mutations (KBs, documents, agents, services,
> ingest) are unaffected — `write` still covers them.

**OIDC role mapping (opt-in).** By default OIDC subjects carry
`scopes: null` (all scopes). Set `auth.oidc.roleMapping` to derive an
RBAC role from a token claim and constrain those subjects:

```yaml
auth:
  oidc:
    roleMapping:
      claim: groups          # token claim holding the role / group(s)
      values:                # claim value → role
        wb-admins: admin
        wb-editors: editor
      default: viewer        # role when the claim is absent / unmapped
```

The claim may be a single value or an array (groups); the
highest-privileged match wins. A per-workspace **principal record**
role still overrides the claim role for that workspace. With no
`roleMapping`, OIDC behavior is unchanged (all scopes) — so this is a
deliberate opt-in, not a silent restriction.

### Surfacing role + scopes (UI / CLI gating)

`GET /auth/me` reports the caller's **effective role and privilege
scopes** alongside the existing identity fields:

```json
{
  "id": "carol",
  "label": "carol@ex.com",
  "type": "oidc",
  "workspaceScopes": ["..."],
  "role": "admin",
  "scopes": ["read", "write", "manage"],
  "expiresAt": 1777230000,
  "canRefresh": true
}
```

`role` and `scopes` are each `null` when no gate applies — an OIDC
subject with no `roleMapping` carries every scope and reports
`{ role: null, scopes: null }`. An API-key subject reports its concrete
scope array, labelled with the matching role when the set corresponds to
a whole role (e.g. `["read"]` → `viewer`). This is a **pure projection**
for client gating; the authoritative gate is always the route-level
`requireScope` / `manageRouteScope` enforcement above, never this field.

Consumers:

- **Web UI** — the `useRole()` hook reads `/auth/me` and hides/disables
  admin-only affordances for non-admins: API-key management, the
  access-control (RLAC) toggle, principal + policy panels, and the
  workspace-delete button (all on the workspace settings page). Gating
  is **permissive by default** — when there is no role signal (login
  disabled, or an unscoped subject) the controls show, because the
  server still enforces the real rule. A positive `viewer`/`editor` role
  (or a concrete scope list without `manage`) hides them.
- **CLI** — `aiw whoami` and `aiw login` surface the role + scopes; a
  `403 forbidden` carrying a "missing required scope" message is
  translated into role guidance ("mint a key with the Admin role"),
  mirroring the existing 401 login-guidance.

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

The cookie value is `v2.<iv>.<ciphertext>.<tag>`; the payload is
encrypted and authenticated with AES-256-GCM using key material from
`auth.oidc.client.sessionSecretRef` (a `SecretRef`). When unset the
runtime generates an ephemeral key at boot and logs a warning — fine
for dev + single-replica, wrong for anything clustered.

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
- **Basic resource ceilings.** The TypeScript runtime rejects
  `/api/v1/workspaces/*` request bodies over 10 MB by default, raises
  that to 50 MB only for explicit ingest routes, and caps the
  highest-risk text/vector fields before chunking, embedding, or
  search dispatch.

Out of scope for now:

- **Distributed denial-of-service and aggregate quotas.** The runtime
  ships an in-process per-IP limiter for `/api/v1/*` and `/auth/*`,
  plus request-size limits, but buckets are per replica. Multi-replica
  deployments still need a WAF/API gateway for global ceilings and
  workspace/user quotas.
- **Complete rate-limit / mutation audit coverage.** Sensitive
  operations, OIDC login/refresh/logout, failed `/api/v1/*` auth
  decisions, and bootstrap-token use emit structured audit events
  today. Rate-limit denials and high-volume document/chunk mutation
  are still tracked as audit gaps.

## Rollout plan

| Phase | Ships | Status |
|---|---|---|
| 1 | Middleware, config, `disabled` mode | ✅ shipped |
| 2 | `mode: apiKey` — workspace-scoped `wb_live_*` keys, issue/revoke routes, UI | ✅ shipped |
| 3a | `mode: oidc` — JWT verification via JWKS; `any` mode enables both | ✅ shipped |
| 3b | Browser OIDC login flow (PKCE) — replaces paste-a-token with `/auth/{login,callback,me,logout}` + encrypted session cookie | ✅ shipped |
| 3c | Silent refresh via `refresh_token` grant, so users don't see mid-session re-logins | ✅ shipped |
| 3d | CLI OIDC device-flow (RFC 8628) via `/auth/device/{authorize,token}` proxy | ✅ shipped (0.2.0) |
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
Phase 4 concern. For strict deployments today, set
`auth.bootstrapTokenRef` to a 32+ character SecretRef, call the API
with `Authorization: Bearer <bootstrap-token>` to create the first
workspace/API key, then remove or rotate that bootstrap secret.

## Bootstrap operator token

`auth.bootstrapTokenRef` is an optional SecretRef accepted when
`auth.mode` is `apiKey`, `oidc`, or `any`. The resolved bearer token
authenticates as an unscoped operator subject
(`workspaceScopes: null`), so it can create the first workspace and
issue the first workspace-scoped API key while
`anonymousPolicy: reject` is already enforced.

Example:

```yaml
auth:
  mode: apiKey
  anonymousPolicy: reject
  bootstrapTokenRef: env:WB_BOOTSTRAP_TOKEN
```

Use a high-entropy value, store it outside source control, and rotate
or remove it after normal operator access is established.

## Secret rotation

Every credential the runtime touches lives behind a **`SecretRef`** — an
`env:NAME` or `file:/path` pointer, never a literal value. The control
plane (Astra tables, the `file` JSON root, SQLite) only ever stores the
*ref*; the `SecretResolver` materializes the value in-process, at use
time. Two consequences shape rotation:

- **The secret store and the control plane are separate.** Rotating a
  provider key, an OIDC client secret, or an Astra token is a change to
  the secret *source* (your env / mounted file / secret manager), not a
  database migration. Records that point at the ref are untouched.
- **Nothing reads a secret back out over the wire.** `GET /setup-status`
  reports `managedEnv.configuredKeys` — the **names** of the managed env
  keys that currently resolve to a non-empty value — so the settings UI
  can confirm a credential is *present* without ever returning the value.
  Service and MCP-server records expose their `credentialRef` (the
  pointer), never the resolved secret. The wire-leak guard
  (`runtimes/typescript/tests/security/wire-leak.test.ts`) pins this for
  every credential-carrying surface.

The mechanics differ by credential class.

### Workspace API keys (`wb_live_*`)

API keys are **rotate-by-replacement**: there is no in-place "change the
secret" — you revoke the old key and mint a new one.

1. **Mint the replacement first** so the integration never goes dark:
   `POST /api/v1/workspaces/{w}/api-keys` with the role/scopes the
   consumer needs (`role: viewer|editor|admin`, or an explicit
   `scopes` array — see [Privilege scopes](#privilege-scopes-read--write--manage)).
   The `plaintext` field is returned **exactly once**; store it in the
   consumer's secret source.
2. **Cut the consumer over** to the new token.
3. **Revoke the old key:** `DELETE /api/v1/workspaces/{w}/api-keys/{keyId}`.
   This is a soft-revoke — the row stays visible with `revokedAt` set, and
   the next request bearing the old token gets `401 unauthorized`.

Issuing and revoking keys both require the **`manage`** scope (admin
role). In the web UI this is the API-keys panel on the workspace settings
page; via the CLI, `aiw` surfaces role-aware guidance on a `403`. Rotate a
key whenever its scopes change — narrowing a key from `admin` to `editor`
means minting a new `editor` key and revoking the old one, since scopes
are fixed at issue time.

### OIDC client secret

The confidential-client secret used by the browser login flow is a
`SecretRef` at `auth.oidc.client.clientSecretRef` (public clients omit
it). To rotate:

1. Add the new secret at the IdP (most IdPs allow two active client
   secrets during a rollover window).
2. Update the value behind `clientSecretRef` in the runtime's secret
   source and **restart** so the new value is resolved at boot.
3. Retire the old secret at the IdP.

The **session-cookie** key (`auth.oidc.client.sessionSecretRef`) rotates
the same way — update the ref and restart. There is no dual-key
validation period: sessions encrypted with the old key stop decrypting
and those users re-login (see
[Session key rotation](#operational-notes)). The **bootstrap operator
token** (`auth.bootstrapTokenRef`) likewise rotates by updating its ref
and restarting; remove it entirely once normal operator access exists.

### Provider API keys (OpenRouter / OpenAI / Cohere / …)

LLM, embedding, and reranking services authenticate with a provider key
resolved from the service's `credentialRef`, falling back to the
runtime's global `chat.tokenRef` (default `env:OPENROUTER_API_KEY`) when a
service sets none. Two rotation paths, depending on where the ref points:

- **Repoint the ref's source (recommended for `env:` / `file:` refs).**
  Update the value in the env / mounted file / secret manager that
  `credentialRef` (or `chat.tokenRef`) names, then restart the runtime so
  the new value is picked up and provider clients reconnect with it. The
  service record is unchanged — it still points at the same ref.
- **Paste a new key at `/settings`** (single-user / `auth: disabled`, or
  the first-run setup wizard). The settings page writes the managed env
  file via `POST /setup/env` and prompts for a restart; on the next boot
  the runtime resolves the new value. `configuredKeys` flips to include
  the key name once it resolves — confirming presence without exposing the
  value.

Either way the secret never enters the control plane. To point a service
at a *different* ref (not just a new value behind the same ref),
`PATCH …/llm-services/{id}` (or the embedding/reranking equivalent) with a
new `credentialRef`; the response echoes the ref, never the resolved
secret.

### External MCP-server credentials

A registered MCP server's bearer credential is a `SecretRef` on the
server record's `credentialRef` (see
[external MCP servers](mcp.md)). The runtime resolves it per connection,
at tool-discovery and tool-call time — so rotation takes effect on the
**next** turn, no restart required:

- **New value, same ref:** update the env / file source the
  `credentialRef` names. The next agent turn reconnects with the fresh
  value.
- **New ref:** `PATCH /api/v1/workspaces/{w}/mcp-servers/{id}` with the
  new `credentialRef` (an admin/`manage`-shaped surface is not required —
  registering and editing MCP servers is workspace `write` content). The
  wire response carries the ref but never the resolved bearer token.

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
of workspace IDs, or a space-separated string — drives the same
workspace-route wrapper that API-key subjects use. Tokens with the
claim set to JSON `null` are treated as unscoped / admin and may
reach any workspace (matches the "operator tokens" escape hatch
described above).

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
| `GET /auth/config` | Tells the UI (and CLI) which credential surfaces are wired up |
| `GET /auth/login` | 302 to the IdP's authorization endpoint; stashes the PKCE verifier + state |
| `GET /auth/callback` | Swaps `code` for tokens, self-verifies, sets the session cookie, redirects |
| `GET /auth/me` | Current authenticated subject, or 401 |
| `POST /auth/logout` | Clears the cookie |
| `POST /auth/device/authorize` | Device-flow start — fronts the IdP's RFC 8628 device authorization endpoint for the CLI (Phase 3d) |
| `POST /auth/device/token` | Device-flow poll — exchanges the `device_code` for a verified access token (Phase 3d) |

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
      sessionSecretRef: env:WB_SESSION_SECRET    # 32+ bytes; cookie encryption key
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
  `sessionSecretRef` and restarting. Sessions encrypted with the old
  key stop decrypting and users re-login. There's no dual-key
  validation period yet.
- **Silent refresh keeps the cookie ahead of the curve (Phase 3c).**
  When the IdP returns a `refresh_token` on the initial code
  exchange, the runtime stores it in the same encrypted session
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
access token, both inside the same encrypted payload. That changes
exactly one threat-model line item from before: cookie theft used
to give an attacker the active session until access-token expiry
(typically an hour). With the refresh token in the cookie, theft
gives the attacker a session as long as the IdP's refresh-token
lifetime allows. Two mitigations:

1. **The cookie remains `HttpOnly` + encrypted/authenticated**, so JS
   still can't read or forge it. The threat is exfiltration via a
   network MITM or browser compromise, not XSS.
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

## CLI device-flow login (Phase 3d, RFC 8628)

`aiw login --oidc` opens an
[OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
against the runtime instead of pasting an API key. The runtime
fronts the IdP's device endpoints, so the CLI never needs the
issuer URL and the IdP client secret stays server-side.

### `/auth/config` additions

```json
{
  "modes": { "oidc": true, "apiKey": true, "device": true },
  "deviceAuthorizePath": "/auth/device/authorize",
  "deviceTokenPath": "/auth/device/token"
}
```

`modes.device` is `true` when the IdP's OIDC discovery document
advertises a `device_authorization_endpoint`. When it isn't, both
device routes return `501 device_flow_not_supported` and the CLI
falls back to the paste-a-token path.

### `POST /auth/device/authorize`

Proxies to the IdP's device authorization endpoint, attaching the
configured `client_id` and any default scopes server-side, and
returns the standard RFC 8628 envelope verbatim:

```json
{
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://login.example.com/device",
  "verification_uri_complete": "https://login.example.com/device?user_code=WDJB-MJHT",
  "expires_in": 600,
  "interval": 5
}
```

### `POST /auth/device/token`

Polled by the CLI with `{ "device_code": "…" }`. Forwards
`grant_type=urn:ietf:params:oauth:grant-type:device_code` to the
IdP, then validates the returned access token through the same
`OidcVerifier` the API uses (iss/aud/exp/nbf/signature). Returns
`{ access_token, refresh_token?, expires_in }` on success and
mirrors the IdP's `authorization_pending`, `slow_down`,
`access_denied`, `expired_token` codes as `400` responses on
failure.

The resulting JWT is what the existing auth middleware already
accepts as `Authorization: Bearer …` — no new verifier path
either side of the proxy. CLI profiles persist the access token,
optional refresh token, and expiry under a new `oidc` block; the
HTTP client prefers the OIDC bearer over the API key when both
are present (see
[`packages/aiw-cli/README.md`](../packages/aiw-cli/README.md)).

### Audit

Both routes emit structured audit events with actions
`auth.device.authorize` and `auth.device.token`. See
[`audit.md`](audit.md) for the full action union.
