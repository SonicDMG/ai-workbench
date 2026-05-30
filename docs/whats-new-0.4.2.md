# What's new in AI Workbench 0.4.2

0.4.2 continues the hardening theme of the 0.4.x line and adds one new
capability — **store-level keyset pagination for chat**. The HTTP wire shape
is unchanged (`{ items, nextCursor }`) and there is **no data migration**.

## Faster chat history (keyset pagination)

Listing an agent's conversations or a conversation's messages used to fetch the
**whole** record set and slice the requested page out of it in the route layer.
That is fine for a handful of turns; it does not scale to a long-running,
tool-heavy conversation, where every page request re-read the entire transcript.

0.4.2 pushes a **keyset cursor** down into all four control-plane backends —
memory, file, SQLite, and Astra:

- **SQLite** range-scans its `pk` index for just the conversation's partition
  instead of reading the whole table.
- **Astra** reads a single partition server-side.
- **memory / file** stay simple but page through the same shared keyset logic,
  so ordering and cursor semantics are identical everywhere.

A few things worth knowing as a client:

- **Cursors are opaque and keyset-based**, not offsets. A row inserted or
  deleted *above* your cursor no longer shifts your position — no skipped or
  repeated rows between pages.
- **Cursors are not stable across deploys.** If you are mid-pagination when the
  runtime is upgraded, the next request returns `400 invalid_cursor`; start
  again from the first page.
- **The message listing still hides internal tool-call scaffolding** (the
  model's pre-tool-call placeholders and tool-result rows). Because that
  filtering happens after paging, a page can come back **shorter than `limit`,
  or even empty, with a non-null cursor**. Keep following `nextCursor` until it
  is `null`; don't stop on a short or empty page. The browser client already
  does this.

Importantly, the **model's view of the conversation is untouched** — prompt
assembly and the MCP façade read the full history, never a single page, so
pagination can never truncate the context the model sees.

The bounded control-plane lists (workspaces, services, knowledge bases, API
keys, agents, …) are small and keep their existing offset cursors.

## A tighter web-fetch boundary for agents

The built-in `native:fetch` agent tool takes a URL **from the model**, which
means a prompt-injection payload can try to steer it at an internal address.
The tool already refused literal private / loopback / link-local / cloud-metadata
IPs and followed no redirects — but a DNS **name** that *resolved* to one of
those addresses slipped past the literal check.

0.4.2 closes that: the tool now **resolves the hostname and validates every
resolved address** against the same blocked ranges before connecting, and fails
closed — a host that won't resolve, resolves to nothing, or resolves to any
blocked address is refused. `redirect: "error"` continues to bound the residual
sub-second DNS-rebind window.

## Cleaner graceful shutdown

A live job-progress stream (`.../jobs/{id}/events`) stays open for as long as the
job runs. Previously that held the HTTP connection open through shutdown, so
`server.close()` waited out its drain timeout whenever a client was attached and
the client saw an abrupt disconnect.

Now, on `SIGTERM` the runtime ends those streams promptly. The browser's
`EventSource` reconnects — to a surviving replica behind your load balancer, or
to the restarted process — and resumes from `Last-Event-ID` where it left off.
Rolling restarts and deploys are quieter and faster as a result.

## Dependency refresh

A conservative, patch/minor-only dependency refresh across every workspace.
`npm audit` reports **0 known vulnerabilities**.
