# What's new in AI Workbench 0.5.1

0.5.1 is a fix-and-polish release on the 0.5.0 **Enterprise Access Control**
line. There is **no HTTP wire-contract change** and **no data migration** — it
closes a UX dead-end introduced with row-level access control and adds a small
control for previewing a knowledge base as any principal.

## Turning on RLAC no longer locks you out of your own knowledge bases

In 0.5.0, enabling row-level access control on a workspace that you browse with
**auth disabled** (the default local / quickstart posture) had an unfortunate
side effect: the moment you opened a knowledge base, every document read failed
with `policy_principal_required` — "this knowledge base requires a principal."

The confusing part was that flip-on bootstrap *had* done its job. It created a
default `admin` principal with universal-read access, exactly so you wouldn't be
locked out. The problem was identity, not authorization: with auth disabled the
runtime has no token to tell *who* you are, so it relies on the web app sending
an `x-view-as-principal` header — and that header was never wired up in the app.
The default `admin` principal existed in the workspace, but nothing on the
request pointed at it, so enforcement rejected the read before it ever got to
"can admin see this?"

0.5.1 wires it up. The web app's API client now sends `x-view-as-principal` on
workspace-scoped requests, defaulting to the `admin` principal (which sees every
document) whenever there's no auth token. Opening a knowledge base in an
RLAC-enabled workspace just works again — no error, no setup, nothing to
configure.

The behavior is deliberately scoped so it only acts where it's needed:

- **No auth token (local / quickstart):** the header is sent, defaulting to
  `admin`, because it's the only identity signal in flight.
- **A bearer token is present (API-key or OIDC deployments):** the header is
  omitted and the runtime derives your principal from the token, exactly as
  before. Nothing changes for token-authenticated deployments.
- **An explicit "view as" selection always wins**, token or not.

## Preview a knowledge base as any principal

Alongside the fix, the knowledge-base explorer gains a discreet **"view as"**
control — a small person icon in the action row, next to Refresh and Ingest.

- It only appears when RLAC is enabled and the app is running without an auth
  token (the posture where view-as is the identity signal). In
  token-authenticated deployments it stays hidden, since the principal comes
  from the token.
- It defaults to `admin`, so 99% of the time it's a quiet, ignorable icon and
  you see everything.
- Switch it to any other principal and it becomes an accent chip naming who
  you're impersonating — a standing reminder that the document list is now
  filtered to what that principal can see. The list refetches under the selected
  identity, so it's an easy way to sanity-check a visibility policy: "does Alice
  actually see only the docs I intended?"

Switching back to `admin` returns you to the see-everything default.

See [`docs/rlac.md`](./rlac.md) for the full row-level access-control model.
