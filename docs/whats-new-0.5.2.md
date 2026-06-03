# What's new in AI Workbench 0.5.2

0.5.2 is a maintenance release on the 0.5.0 **Enterprise Access Control** line.
There is **no HTTP wire-contract change** and **no data migration** — the
runtime, API, and web app behave exactly as they did in 0.5.1. This release
clears out a metric that never carried a signal and brings the contributor
codemaps back in line with the shipped code. If you are running 0.5.1, the only
externally visible change is on the `/metrics` endpoint described below.

## A metric that always read zero is gone

The runtime exported a Prometheus counter, `workbench_chat_stream_tokens_total`,
that was registered with the metrics registry but never incremented anywhere in
the code. Every deployment therefore scraped a flat `0`, the bundled Grafana
dashboard rendered a permanently empty "Stream tokens / sec" panel, and the docs
described a metric with nothing behind it.

Wiring it up faithfully would mean splitting tokens into prompt (`in`) and
completion (`out`) to populate the counter's `direction` label — but the chat
abstraction does not expose that split. `ChatCompletion` and `ChatStreamEvent`
carry only a single total `tokenCount`, and the OpenAI-compatible provider
deliberately narrows the API `usage` object down to `total_tokens`. Emitting a
real `direction` breakdown would be a cross-cutting change across the chat layer
and every provider, so rather than leave a misleading always-zero series in
place, 0.5.2 removes it.

The counter is gone from the runtime metrics registry, the bundled Grafana
dashboard, the metrics table in `docs/production.md`, and the metric list in
`docs/api-spec.md`. **If you scrape `workbench_chat_stream_tokens_total` or
reference it in a dashboard or alert, remove it** — there is no replacement
metric, because there was never any data behind the original.

## Contributor codemaps now match the code

The `docs/CODEMAPS/*` files — the contributor-facing map of routes, services,
data model, and dependencies — had drifted from the 0.5.x source. 0.5.2
reconciles them:

- A route undercount in the frontend map is corrected, along with several stale
  routes and three out-of-date table names in the data map.
- Misleading "Generated:" headers (these maps are curated, not machine-generated)
  are relabeled to stop implying they regenerate themselves.
- The `packages/aiw-cli` package and the Auth service boundary are added, and the
  scoped-auth decision from 0.5.0 is recorded.
- The RLAC "(prototype)" labels are dropped now that row-level access control
  ships enforced on every read path.

These are documentation changes for contributors only; they do not affect the
runtime, the API, or the web app.

See [`CHANGELOG.md`](./CHANGELOG.md) for the full 0.5.2 entry, and
[`docs/whats-new-0.5.0.md`](./whats-new-0.5.0.md) for the narrative tour of the
Enterprise Access Control release this line builds on.
