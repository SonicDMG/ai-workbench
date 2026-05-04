# Architecture Decision Records

ADRs capture the **why** behind structural choices in this repo —
moments where the alternative wasn't obviously wrong and the
reasoning would be hard to reconstruct from `git log` six months
later.

We file an ADR when a change:

- Splits or merges a public interface that downstream callers depend
  on (e.g. `ControlPlaneStore` in [0002](./0002-per-aggregate-repos.md)).
- Introduces a new layering rule (e.g. routes-are-thin in
  [0001](./0001-services-domain-layer.md)).
- Picks one of multiple defensible technical paths and the runner-up
  could come back later.
- Defines a contract that other runtimes (Python, Java) will need to
  match.

We don't file an ADR for: bug fixes, dependency bumps, formatting,
test additions that don't change behavior, or refactors that are
purely internal to a single module.

## Format

Each ADR is one Markdown file numbered `NNNN-kebab-title.md`. The
shape is:

- **Status** — Proposed / Accepted / Superseded by ADR-XXXX.
- **Context** — What forced the decision. The pressure, the
  constraint, what existed before.
- **Decision** — What we chose, in one paragraph.
- **Consequences** — What this makes easier, what it makes harder,
  and what's deferred.
- **References** — PRs, issues, related ADRs.

Supersession (rather than editing) is the rule — the trail of
abandoned alternatives is the value of the format.

## Index

- [0001 — Services domain layer (route-thin)](./0001-services-domain-layer.md)
- [0002 — Per-aggregate repository interfaces](./0002-per-aggregate-repos.md)
