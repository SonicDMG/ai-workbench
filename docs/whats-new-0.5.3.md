# What's new in AI Workbench 0.5.3

0.5.3 is a security-tooling and dependency-maintenance release on the 0.5.0
**Enterprise Access Control** line. There is **no HTTP wire-contract change** and
**no data migration** — the runtime, API, and web app behave exactly as they did
in 0.5.2. It adds a trust gate for MCP tool definitions and keeps PDF ingestion
working across a major `pdfjs-dist` upgrade.

## A trust lockfile for MCP tool definitions

AI Workbench both hosts an MCP server (`/api/v1/workspaces/{id}/mcp`) and lets
agents connect to your own external MCP servers as tools. In both cases an agent
reads each tool's *description* and *input schema* to decide what to do — so a
server that silently rewrites a tool definition (a "rug-pull") can steer an agent
without anyone noticing. It's the classic tool-poisoning vector.

0.5.3 guards against this the way we guard dependency versions: with a committed
lockfile. Using [`toolprint`](https://github.com/jestatsio/toolprint), the MCP
tool surface of our own server and of the external servers we trust
(`.toolprint/mcp.json`) is hashed and pinned into `toolprint.lock`. Every change
is diffed against that pin; drift — a changed description or schema, an injected
instruction, or a leaked secret — fails CI. The scanner only lists tools; it
never executes one.

Run it locally with `npm run security:mcp`, and `npm run security:mcp -- --pin`
to re-pin after an intentional change (the `toolprint.lock` diff then lands in
code review, so a reviewer sees exactly which tool definitions moved). See
[`docs/mcp-trust.md`](./mcp-trust.md) and the new "MCP tool-surface trust"
section in [`SECURITY.md`](../SECURITY.md).

This is dev/CI tooling — it does not change the runtime, the API, or the web app.

## PDF ingestion keeps working on pdfjs-dist 6

The `pdfjs-dist` text extractor behind `POST /ingest/file` was updated for the
library's 5 → 6 major upgrade, which removed `PDFDocumentProxy.destroy()`.
Teardown now goes through the loading task instead, so PDF uploads continue to
extract text and chunk exactly as before — no change to how you ingest files.

See [`CHANGELOG.md`](../CHANGELOG.md) for the full 0.5.3 entry, and
[`docs/whats-new-0.5.0.md`](./whats-new-0.5.0.md) for the narrative tour of the
Enterprise Access Control release this line builds on.
