# Production checklist

AI Workbench can boot with zero credentials for local development.
Production deployments should tighten a few knobs before exposing the
runtime beyond a trusted loopback or private admin network.

## Required before exposure

- **Use the production environment guard.** Set
  `runtime.environment: production` in your deploy config. The
  TypeScript runtime then refuses configs that leave auth disabled,
  allow anonymous API traffic, use the in-memory control plane, or
  enable browser OIDC login without a persistent session secret.
  Start from
  [`runtimes/typescript/examples/workbench.production.yaml`](../runtimes/typescript/examples/workbench.production.yaml).
- **Turn on auth.** Use `auth.mode: apiKey`, `oidc`, or `any` with
  `anonymousPolicy: reject`. The runtime logs a warning when a
  non-memory control plane accepts anonymous API traffic.
- **Use a bootstrap token instead of opening anonymous access.** Set
  `auth.bootstrapTokenRef` to a 32+ character secret ref, create the
  first workspace/API key with `Authorization: Bearer <bootstrap>`,
  then remove or rotate the bootstrap secret once operator access is
  established.
- **Use a persistent OIDC session key.** Browser login deployments
  should set `auth.oidc.client.sessionSecretRef` to a 32+ byte secret.
  Without it, all sessions invalidate on restart and multi-replica
  sessions cannot decrypt consistently.
- **Serve over HTTPS.** Put the runtime behind a TLS-terminating
  reverse proxy or ingress and set `runtime.publicOrigin` to the
  externally visible `https://...` origin. Only set
  `runtime.trustProxyHeaders: true` when a trusted proxy overwrites
  incoming `X-Forwarded-*` headers.
- **Keep local files out of build contexts.** The repo ships a
  `.dockerignore` that excludes `.env*`, local state, build output,
  and dependency folders. Keep deployment-specific secrets outside the
  Docker build context as well.

## Persistence

- **Use `astra` for multi-replica production.** The `file` backend is
  single-node only. Do not point two containers at the same file root.
- **Back up file-backed state.** If using `controlPlane.driver: file`,
  back up the JSON root and mount it on durable storage. The backend
  uses atomic rename for writes, but it is not a database and does not
  provide multi-process locking or point-in-time restore.
- **Enable job resume in clustered deployments.** For `astra`, set
  `controlPlane.jobsResume.enabled: true` so another replica can claim
  stale async-ingest leases after a crash.

## Operational hardening

- **Pin and rotate secrets.** Prefer `env:` or `file:` secret refs for
  Astra, OIDC, session, and bootstrap credentials. Rotate workspace
  credentials by updating the secret source and restarting the runtime
  so in-process driver caches reconnect with fresh credentials.
- **Forward audit events to a durable sink.** The runtime emits
  structured audit events for API-key issuance/revocation, workspace
  create/delete, and OIDC login/refresh/logout (see
  [`docs/audit.md`](./audit.md) for the catalog and envelope shape).
  Events are pino lines at `info` with `audit: true`; route them to a
  SIEM/file via your container log pipeline. RBAC enforcement remains
  on the roadmap.
- **Apply rate limiting in front of the runtime.** The in-process
  limiter defaults to 600 req/min/IP for `/api/v1/*` and 30 req/min/IP
  for `/auth/*`; tune via `runtime.rateLimit` or set
  `runtime.rateLimit.enabled: false` and front the runtime with a WAF
  / API gateway. See [`docs/configuration.md`](./configuration.md).
- **Keep dependency automation on.** CI runs lint/typecheck/test/build,
  coverage, secret scanning, Docker smoke, Playwright, Python/Java
  scaffold tests, and Dependabot updates. GitHub CodeQL default setup
  covers code scanning for this repo.

## Browser posture

The bundled runtime emits security headers for the SPA and API docs:
`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy`.
If a reverse proxy injects its own headers, make sure it preserves or
tightens those defaults rather than stripping them.
