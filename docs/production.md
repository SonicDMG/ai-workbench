# Production checklist

AI Workbench can boot with zero credentials for local development.
Production deployments should tighten a few knobs before exposing the
runtime beyond a trusted loopback or private admin network.

## Required before exposure

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
  reverse proxy or ingress and forward `X-Forwarded-Proto: https` so
  session cookies get the `Secure` attribute.
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
- **Watch audit gaps.** Request IDs are present today; per-operation
  audit logs and RBAC are still planned. Put the runtime behind an API
  gateway or reverse proxy if you need centralized audit trails now.
- **Apply rate limiting upstream.** The runtime has body and field
  limits, but IP/user/workspace rate limiting is not built in yet.
- **Keep dependency automation on.** CI runs lint/typecheck/test/build,
  coverage, CodeQL, secret scanning, Docker smoke, Playwright, and
  Dependabot updates.

## Browser posture

The bundled runtime emits security headers for the SPA and API docs:
`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy`.
If a reverse proxy injects its own headers, make sure it preserves or
tightens those defaults rather than stripping them.
