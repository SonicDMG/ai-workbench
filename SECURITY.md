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
  designed to handle. AI Workbench is pre-alpha; we don't claim
  DoS resistance yet.

## Secrets handling

AI Workbench stores credentials as `SecretRef` pointers (`env:FOO`,
`file:/path`), never as raw values. If you find a code path that
logs, persists, or echoes back a **resolved** secret value, treat it
as a security bug and report it through the channel above.

## Supported versions

This repo is pre-1.0. Security fixes land on `main` and are available
as soon as you pull. Once we start cutting tagged releases, a
"Supported versions" table will appear here.
