# Cross-replica jobs — design note

Status snapshot:

| Slice | Status |
|---|---|
| Subscription fan-out via Astra-table polling | ✅ shipped |
| Lease columns + heartbeat on running jobs | ✅ shipped |
| Orphan-sweeper that reclaims stale leases (detect + mark failed) | ✅ shipped |
| Pipeline resume after reclaim | planned (needs persisted ingest input) |

Captures the design space around two open items from `roadmap.md`
Phase 2b:

> Cross-replica job pub/sub + in-flight resume after restart (today
> the record survives restart but the owning worker doesn't).

The note exists so each implementation PR is a one-mechanic change,
not a discovery exercise. Subscription fan-out shipped via the
Astra-table polling backend; the lease + heartbeat + sweeper slices
shipped together as the in-flight-resume foundation. Actual pipeline
re-run from the last upserted chunk is the remaining piece — the
sweeper currently marks orphans `failed` with an actionable error
message instead of looping the original ingest, because the original
`IngestRequest` (text, sourceFilename, chunker opts) isn't persisted
alongside the job record. Adding `ingest_input_json` is a one-
column migration; see "Open questions for the implementer" below.

## Today's behavior

The async-ingest path lives in
[`runtimes/typescript/src/routes/api-v1/documents.ts`](../runtimes/typescript/src/routes/api-v1/documents.ts):

1. `POST /catalogs/{c}/ingest?async=true` calls `jobs.create(...)`,
   spawns `void runAsyncIngest({...})`, and returns 202 to the
   caller with the job pointer.
2. The detached worker drives chunking → embedding → upsert,
   updating the job record via `jobsStore.update(...)` along the
   way. Failure modes flip the record to `failed` with a sanitized
   error message.
3. SSE consumers connect to `GET /jobs/{jobId}/events`. The route
   calls `jobs.subscribe(workspace, jobId, listener)` and the
   listener fan-out lives in
   [`runtimes/typescript/src/jobs/subscriptions.ts`](../runtimes/typescript/src/jobs/subscriptions.ts) —
   a `Map<string, Set<JobListener>>` keyed by `(workspace, jobId)`.

Three durable `JobStore` backends ship today: `memory`, `file`, and
`astra`. All three share the in-process `JobSubscriptions` for
listener fan-out — the durable storage round-trips, but the
notification half is in-memory only.

## Two problems to solve

### Problem 1 — Cross-replica subscription fan-out

If replicas A and B both serve the API, an ingest started on A
writes its progress through the durable store. A subscriber on
replica B (because the load balancer routed `/jobs/{id}/events` to
the wrong pod) sees the durable record on its first read but never
receives push updates — `JobSubscriptions` only fires for listeners
registered on the same process where `update()` was called.

Without fan-out, the SSE stream on B silently goes quiet and the
client falls back to the existing polling path
([`useJobPoller`](../apps/web/src/hooks/useIngest.ts)). That's not
broken, but it defeats the point of SSE.

### Problem 2 — In-flight resume after restart

A `void runAsyncIngest(...)` is bound to the process that started
it. If the runtime restarts (deployment, OOM, sigkill), the job
record is preserved but the worker is gone. The job sits at
`status: running` forever; clients eventually time out their poll
or the SSE never closes.

The two problems share a substrate but are independently shippable
and have distinct requirements.

## Constraints to stay inside

- **No new infra in single-node deployments.** The current
  `controlPlane.driver: memory|file|astra` model is the operator's
  full configuration surface today. Any cross-replica wiring must
  be opt-in and degrade cleanly to today's behavior when not
  configured.
- **Astra-first.** The runtime's existing durable backend is Astra
  Data API. Reusing it for pub/sub keeps the operational story
  simple — same credentials, same VPC, same monitoring.
- **Polyglot-friendly.** The conformance harness covers every
  language runtime. Whatever pub/sub mechanic we pick has to be
  implementable from Python and any other green box that lands.
- **Don't churn the wire contract.** The SSE event shape stays as
  it is today; this is purely about making the in-process listener
  fire on the right replicas.

## Pub/sub options

### A. Postgres `LISTEN`/`NOTIFY`

Pros: native to PG, sub-second latency, no extra service.

Cons: AI Workbench's reference deployment doesn't ship a Postgres.
Pulling one in for fan-out only is a heavy ask.

**Reject** for the reference deployment; could be a registered
backend if a self-hosted runtime brings its own PG.

### B. Redis pub/sub

Pros: well-understood, fast, one-line clients in every runtime.

Cons: another service to deploy and credential. Not currently in
our stack.

**Reject** for the reference deployment for the same reason as
Postgres. Reasonable as a registered backend.

### C. Astra Streaming (Pulsar)

Pros: same vendor as the existing Astra Data API.

Cons: separate billing, separate auth, materially more complex than
the alternatives. Overkill for "wake up another replica when a job
record changes."

**Reject** for first iteration. Worth revisiting if we ever need
durable cross-replica event logs (chats, audit trails) for which
streaming is a better fit.

### D. Astra Data-API table polling (chosen)

The job records already live in the `wb_jobs_by_workspace` table
(see
[`runtimes/typescript/src/jobs/astra-store.ts`](../runtimes/typescript/src/jobs/astra-store.ts)).
Replicas poll a small "recent updates" view of that table on a
short interval (~250–500ms) and fan out to local subscribers
whenever they see a record they're subscribed to with a newer
`updatedAt` than they last saw.

Pros:

- Zero new infra. Reuses the same Astra credentials and table
  layout the runtime already manages.
- Trivially implementable in every language runtime (it's just an
  extra periodic `find()` against an existing table).
- Polling is a degenerate-but-correct strategy: if the replica is
  off the network briefly, it catches up on reconnect.
- Backpressure-friendly. Subscribers fall behind gracefully; no
  unbounded queue.

Cons:

- Latency floor matches the poll interval. SSE clients see updates
  ~250–500ms slower than they would over a true pub/sub channel.
  Acceptable for ingest progress, which already runs at the
  granularity of "chunks processed per second".
- Cost. Each replica issues N polls per second; with M replicas,
  M·N reads per second baseline. Cheap on Astra Data API but worth
  measuring before claiming "no cost."

**Choose D for v1.** Path of least resistance, no new dependencies,
no new credentials. Sub-second latency is plenty for ingest. If
chats / agent streams arrive later and need true push, swap in
Pulsar (C) behind the same `JobSubscriptions` interface.

## Subscription seam

`JobStore.subscribe()` already exists and returns an unsubscribe.
The change is internal to the store implementation:

```ts
// File: runtimes/typescript/src/jobs/astra-store.ts (sketch)
class AstraJobStore implements JobStore {
  // …
  private readonly subs = new JobSubscriptions();
  private pollerHandle: NodeJS.Timeout | null = null;
  private lastSeen = new Map<string /*key*/, string /*updatedAt*/>();

  async subscribe(workspace, jobId, listener) {
    const off = this.subs.add(workspace, jobId, listener);
    this.ensurePollerRunning();
    // Existing immediate-replay-on-subscribe semantics stay.
    const current = await this.get(workspace, jobId);
    if (current) listener(current);
    return () => {
      off();
      this.maybeStopPoller();
    };
  }

  private ensurePollerRunning() {
    if (this.pollerHandle) return;
    this.pollerHandle = setInterval(() => this.tick(), 500);
  }

  private async tick() {
    // For each (workspace, jobId) with at least one subscriber:
    //   - Read the current record.
    //   - If updatedAt > lastSeen[(workspace, jobId)], emit + update lastSeen.
    // The local subscription registry is the source of truth for
    // "what jobs do I care about right now"; we never poll for jobs
    // no replica is watching.
  }
}
```

Critical: the `update()` path stays unchanged. A replica that
mutates a record fans out locally as it does today; the cross-
replica path is *only* the polling tick. That keeps the latency on
"my own replica's ingest" exactly as it is now (microseconds), and
adds polling cost only for jobs other replicas are watching.

The memory and file backends need no change. They aren't designed
for multi-replica deployments — file-backed SSE across two replicas
sharing a filesystem is a real edge case but not one we want to
optimize for.

## In-flight resume

The harder problem. Two sub-problems:

**1. Detect orphaned jobs.** A job is orphaned when its record
shows `status: running` but no replica is currently driving it.
The cleanest signal is a "leased" model:

```
job.leasedBy: string | null   // replica id, set when work begins
job.leasedAt: timestamp       // bumped on every update by the leaseholder
```

A replica claims a job with `update({leasedBy: my_id, leasedAt: now})`,
heartbeats it on every progress update, and a sweeper considers any
running job whose `leasedAt` is older than 60 seconds as orphaned.
The sweeper attempts a CAS-style re-lease — `update({leasedBy: my_id, leasedAt: now})`
guarded by `where leasedBy = old_id` — and either picks it up or
loses the race to another sweeper.

**2. Resume the work.** This is the part where "swap in pub/sub"
isn't enough. The pipeline state — chunker offset, current chunk
index, embedder retry state — lives in the worker's local
variables. To resume, we'd need to **persist** that state on every
chunk-boundary update.

Two flavors:

- **Re-do from the last checkpoint.** Cheapest. The chunker is
  deterministic; if we persist `(documentUid, lastChunkIndex)`
  on every successful upsert, a resuming worker re-chunks from the
  start, embeds + upserts past `lastChunkIndex` (or skips them
  with a "is this id already present?" check), and continues. Cost:
  re-running the chunker. Win: no new state shape; the existing
  `processed` field is the checkpoint.

- **Idempotent upsert.** Already true today — the upsert key is
  `(documentUid, chunkIndex)`. So even a resuming worker that
  re-runs from chunk 0 won't double-write. The cost is just CPU on
  the chunker.

**Choose re-do-from-checkpoint.** Idempotency is already a
property of the system; we get cheap resume for free.

### Sweeper placement

Run the sweeper on every replica with the durable backend
configured. Each replica does a `find` for `status: running` jobs
with stale `leasedAt` once per minute, attempts the lease-claim,
and starts the resume pipeline on success. Multiple replicas
racing on the same orphan is fine — the CAS guarantees only one
wins.

A single replica deployment trivially handles this case: it always
wins the race and resumes whatever it was doing before the
restart.

## Migration & rollout

1. **Land subscription polling on the Astra backend.** No wire
   change, no API change. SSE just starts working across replicas.
   Default poll interval 500ms, configurable via
   `controlPlane.jobPollIntervalMs`.
2. **Add the lease columns.** New migration on
   `wb_jobs_by_workspace`. Existing rows get `leasedBy: null,
   leasedAt: null`. The sweeper treats null-leased running jobs as
   orphaned (with a grace period off `updatedAt`) so we recover
   anything in-flight at deploy time.
3. **Wire the sweeper.** Off by default; enable with
   `controlPlane.jobsResume.enabled: true`. Single-replica
   deployments leave it off to skip the lease bookkeeping.
4. **Conformance.** Add scenarios for "subscribe → see update from
   another writer" and "kill the leaseholder → another replica
   resumes". Both are timing-dependent; either pin them with
   `pollUntil` (a runner addition we'd need to make) or keep them
   in runtime tests rather than the cross-language corpus.

## Out of scope

- **Replacing the in-process `JobSubscriptions` with an external
  bus** (Redis, Pulsar, etc.). Reachable later behind the same
  `JobStore.subscribe` seam; the polling backend is sufficient
  until measured load says otherwise.
- **Cross-replica chats / agent streams.** Different latency
  budget, different fan-out shape. When chats land
  ([`roadmap.md` Phase 4](roadmap.md)) we'll pick a real pub/sub
  layer; until then, the polling Astra backend serves jobs fine.
- **Worker pools.** Today an ingest is one process; if it's slow,
  it's slow. A future "schedule N parallel embedders" change is
  orthogonal to this design.

## Open questions for the implementer

1. **Poll interval default.** 500ms feels right for ingest but is
   a guess. Set it conservatively at 1000ms initially and let
   operators tune down.
2. **Lease grace.** 60 seconds is conservative; with 1-second
   poll-and-update cadence we could go to 5–10 seconds. Worth
   benchmarking before locking the constant.
3. **Replica id source.** Easiest is `crypto.randomUUID()` at
   startup. Kubernetes-aware operators may want
   `process.env.HOSTNAME` so the lease holder is greppable in
   logs. Surface a config knob.
4. **What about the file backend?** File SSE across replicas
   sharing a mounted filesystem is an unusual deployment. The
   pragmatic answer is "we don't support that"; document it.
