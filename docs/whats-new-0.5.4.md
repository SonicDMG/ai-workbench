# What's new in AI Workbench 0.5.4

0.5.4 is a beta-feedback release on the 0.5.0 **Enterprise Access Control**
line — every change responds to first-wave beta feedback (thanks, David
Jones-Gilardi). It adds bulk document deletion and parallel ingest to the
Knowledge Base Explorer, and fixes three things that broke the Docker
quickstart on the first run. There is one **additive** wire-contract change
(the new bulk-delete endpoint), **no breaking change**, and **no data
migration**.

## Bulk select + delete in the Knowledge Base Explorer

Clearing 100 documents used to take 100 trash clicks and 100 confirmation
dialogs. The document table now has a checkbox column with select-all scoped to
the *visible/filtered* rows — a filter narrows the blast radius, never widens
it — plus a "Delete selected (N)" action bar and a single confirmation for the
whole batch.

Server-side, the new
`POST /api/v1/workspaces/{ws}/knowledge-bases/{kb}/documents/bulk-delete`
endpoint takes `{ documentIds: string[] }` (1–100 ids per call; the web app
pages larger selections). Bulk is **not a side door around row-level policy**:
each id runs the same RLAC mutation gate, the same chunk cascade, and writes
the same audit record as the single DELETE. Per-id failures land in a `failed`
array without aborting the rest of the batch, and the web app reports partial
failures in a warning toast.

## Parallel ingest in the queue dialog

The ingest queue drained one file at a time, even though the runtime already
bounds concurrent ingest jobs server-side (default 4). The queue now keeps up
to N jobs in flight — a "Parallel ingests" picker (1/2/4/8, default 4) in the
queue header — and every running row streams its own live progress. Set it to
`1` to restore the old sequential behavior for rate-limited embedding
providers. Duplicate/name-conflict prompts still surface one at a time, and a
failing file fails independently without tanking the batch.

## The Docker quickstart works on the first run

Three fixes, all from the same beta pass:

- **Writable data volume.** The image runs as the non-root `node` user but
  never created `/var/lib/workbench`, so Docker initialized the named volume
  root-owned and the first workspace write failed with `EACCES`. The mount
  point is now pre-created with the right ownership — no `user: "0:0"`
  override, no manual `chown`.
- **Ollama on the host is reachable.** The base URL was hardcoded to
  `localhost`, which inside a container is the container itself. The runtime
  now honors `OLLAMA_BASE_URL` (compose defaults it to
  `http://host.docker.internal:11434/v1`, with a host-gateway mapping that
  also covers Linux Engine), the LLM service form gains an **Endpoint base
  URL** field, and transport errors now name the endpoint they tried. See
  "Ollama on the host" in [`docs/docker.md`](./docker.md).
- **Mock workspaces ingest out of the box.** Mock workspaces were seeded with
  a credential-less NVIDIA embedding service, so the first ingest failed with
  `400 embedding_unavailable`. They now seed the credential-free mock
  embedder, so the zero-credential demo flow works end to end.

See [`CHANGELOG.md`](../CHANGELOG.md) for the full 0.5.4 entry, and
[`docs/whats-new-0.5.0.md`](./whats-new-0.5.0.md) for the narrative tour of the
Enterprise Access Control release this line builds on.
