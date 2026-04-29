# Security Policy

Thanks for helping keep AI Workbench and its users safe.

## Reporting a vulnerability

**Please don't open a public GitHub issue for security bugs.** Public
issues tip attackers off before we can patch.

Report privately via GitHub's
[private vulnerability reporting](https://github.com/datastax/ai-workbench/security/advisories/new).
We see these immediately and can collaborate on a fix in a private
fork before disclosure.

Please include:

- A clear description of the vulnerability and its impact.
- Reproduction steps — ideally a minimal proof of concept.
- Your suggested severity (CVSS or plain English) if you have one.
- Whether you've disclosed this anywhere else.

## What to expect

- **Acknowledgement** within 3 business days.
- **Initial triage and severity rating** within 7 business days.
- **Fix and coordinated disclosure** once a patch is ready. Timeline
  depends on severity; we aim for CVSS 9.0+ fixes within 30 days.
- We'll credit you in the release notes if you want.

## Scope

In scope:

- [`runtimes/typescript/`](./runtimes/typescript/) — the default
  TypeScript runtime.
- [`runtimes/python/`](./runtimes/python/) and
  [`runtimes/java/`](./runtimes/java/) — scaffolds (operational
  endpoints only; every `/api/v1/*` route returns `501` today).
- [`apps/web/`](./apps/web/) — the workspace management UI.
- [`conformance/`](./conformance/) — the shared conformance harness.
- [`.github/workflows/`](./.github/workflows/) — build, test, and
  release tooling.

Out of scope:

- **Third-party dependencies** — report upstream. We track updates via
  Dependabot.
- **DataStax Astra itself** — see DataStax's own security disclosure
  program.
- **Denial-of-service** that requires volumes this runtime was never
  designed to handle. AI Workbench ships an in-process per-IP rate
  limiter on `/api/v1/*` (default 600 req/min) and `/auth/*` (30
  req/min) as a defense-in-depth layer — see
  [`docs/configuration.md`](./docs/configuration.md#rate-limiting)
  for tuning. Buckets are not shared across replicas, so multi-
  replica deployments should still front the runtime with an
  upstream WAF or API gateway for accurate aggregate ceilings.

## Secrets handling

AI Workbench stores credentials as `SecretRef` pointers (`env:FOO`,
`file:/path`), never as raw values. If you find a code path that
logs, persists, or echoes back a **resolved** secret value, treat it
as a security bug and report it through the channel above.

## Browser security headers

The TypeScript runtime applies a single hardening middleware to every
response — see
[`runtimes/typescript/src/lib/security-headers.ts`](./runtimes/typescript/src/lib/security-headers.ts).
A regression in any of these is in scope for a security report.

| Header | Value | Notes |
| --- | --- | --- |
| `Content-Security-Policy` | strict default; relaxed only on `/docs` | SPA + API: `default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`. `/docs` (Scalar) pins `cdn.jsdelivr.net` and allows the inline bootstrap that vendor library requires; the relaxation is scoped to that single route. |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | Emitted only when `runtime.environment` is `production`. Plaintext-HTTP dev servers don't get HSTS — pinning a browser to HTTPS for a misconfigured deployment is hard to recover from. The runtime never emits `preload`; that's an operator decision. |
| `X-Frame-Options` | `DENY` | Defense in depth alongside CSP `frame-ancestors 'none'`. |
| `X-Content-Type-Options` | `nosniff` | Forces declared content types. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolates the SPA's browsing context from popups it didn't open. |
| `Permissions-Policy` | `camera=(), geolocation=(), microphone=(), payment=(), usb=()` | Empty allowlists turn off the listed capability APIs for the runtime origin and any nested frames. |

### CORS posture

The runtime intentionally **does not set** `Access-Control-Allow-Origin`
or any other CORS headers. The bundled web UI (`apps/web/`) is
same-origin with the API, and the API is not designed to be called
from third-party browser origins. Multi-origin deployments must front
the runtime with a reverse proxy that owns the CORS contract — adding
permissive CORS at the runtime layer would invalidate the
`Cross-Origin-Opener-Policy` and `frame-ancestors` guarantees above.

If you need a browser client on a different origin to call the API,
issue a workbench API key and have a server-side proxy (your own
backend) make the call. Browser-initiated cross-origin calls into the
runtime are not a supported deployment shape.

## Supported versions

This repo is pre-1.0. Security fixes land on `main` and are available
as soon as you pull. Once we start cutting tagged releases, a
"Supported versions" table will appear here.
