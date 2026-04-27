# AI Workbench — Python runtime

One of N language **green boxes** for AI Workbench. A FastAPI app that
exposes the same `/api/v1/*` surface as the TypeScript runtime, talking
to Astra via [`astrapy`](https://github.com/datastax/astrapy)
internally.

The UI picks which green box to target at deploy time via
`BACKEND_URL`. Deploy this runtime as a Docker container and point the
UI at it — no changes needed on the UI side.

## Status

**Scaffold.** The FastAPI app boots, the operational endpoints
(`/healthz`, `/readyz`, `/version`, `/`) work, and the OpenAPI doc at
`/docs` shows every `/api/v1/*` route. Every `/api/v1/*` route
currently raises `NotImplementedApiError` → HTTP 501 with the canonical
error envelope.

## Quickstart

```bash
# 1. Install the runtime in editable mode with dev deps.
cd runtimes/python
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

# 2. From the repo root, in a separate terminal — start mock-astra.
# Leave it running while you iterate.
npm run conformance:mock

# 3. Run the tests. You'll see:
#    - 7 passing operational tests (healthz, version, request-id, etc.)
#    - 1 passing error-envelope sanity check
#    - 3 xfail (strict) conformance scenarios — flip these as you
#      implement routes.
pytest
```

To run the server standalone (e.g. to hit it with curl or point a UI at
it):

```bash
# With Astra env vars
export ASTRA_DB_API_ENDPOINT=https://<db>-<region>.apps.astra.datastax.com
export ASTRA_DB_APPLICATION_TOKEN=AstraCS:...
export ASTRA_DB_KEYSPACE=workbench

# Launch via the entry point or directly via uvicorn
workbench
# equivalently:
uvicorn workbench.app:app --host 0.0.0.0 --port 8080
```

Then:

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/version
open http://localhost:8080/docs          # interactive OpenAPI
```

## Where to start implementing

Each `NotImplementedApiError` in
[`src/workbench/routes/`](./src/workbench/routes/) corresponds to one
step in
[`../../conformance/scenarios.md`](../../conformance/scenarios.md).
Suggested order:

1. `POST /api/v1/workspaces` — scenario `workspace-crud-basic` step 1.
   Plumb astrapy into [`workbench/astra.py`](./src/workbench/) (new
   file) and wire the route in
   [`workbench/routes/workspaces.py`](./src/workbench/routes/workspaces.py).
2. `GET` / `PUT` / `DELETE` for workspaces — completes the workspace
   scenarios.
3. Chunking / embedding / reranking service CRUD.
4. Knowledge-base CRUD with auto-provisioned vector collections.
5. KB data plane — records, search, documents, ingest.

Each time you flip a conformance test green, remove its
`@pytest.mark.xfail` decorator in
[`tests/test_conformance.py`](./tests/test_conformance.py). The
`xfail(strict=True)` means a passing-without-removal fails CI — so you
can't accidentally leave a test un-promoted.

## Internal layers

Once you start calling Astra:

```
FastAPI route handler
    ↓
workbench/astra.py           ← astrapy-backed helpers for wb_* tables
    ↓
astrapy                      ← DataStax-maintained SDK
    ↓
Astra Data API (HTTPS)
```

Keep route handlers thin — they should validate with Pydantic (free
via FastAPI), call into `workbench/astra.py`, and return the response
model. Business logic that isn't just "forward to astrapy" stays out
of the handlers.

Don't build a separate `workbench-astra-client` library. The
workbench-specific mapping between `WorkspaceRecord` and a Data API
Table row is runtime-internal concern — not something we publish.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `WORKBENCH_HOST` | `0.0.0.0` | Bind address |
| `WORKBENCH_PORT` | `8080` | Listen port |
| `WORKBENCH_LOG_LEVEL` | `info` | uvicorn log level |
| `ASTRA_DB_API_ENDPOINT` | *(unset)* | Astra Data API URL |
| `ASTRA_DB_APPLICATION_TOKEN` | *(unset)* | Astra application token |
| `ASTRA_DB_KEYSPACE` | `workbench` | Keyspace hosting `wb_*` tables |

The UI discovers this runtime via its own **`BACKEND_URL`** env var.
That's the UI's concern, not the runtime's — this runtime just serves
whatever address it binds to.

## Conformance behavior

[`tests/test_conformance.py`](./tests/test_conformance.py) runs every
scenario as HTTP requests against the FastAPI app (in-process via
`httpx.ASGITransport`). Responses are compared to shared fixtures in
[`../../conformance/fixtures/`](../../conformance/fixtures/).

Fixtures ship from the canonical TypeScript runtime via
`npm run conformance:regenerate`. Python's conformance tests remain
`xfail(strict=True)` until the matching routes are implemented; flip
them off per scenario as you go.

The mock-astra server is a **standard deterministic backend** for
every green box — not a conformance assertion target. If you want to
see what the runtime is sending to Astra while debugging, inject the
`mock_captured` fixture:

```python
async def test_debug(client, mock_captured):
    await client.post("/api/v1/workspaces", json={...})
    print(mock_captured())   # list of dicts: {method, path, headers, body}
```

## Structure

```
runtimes/python/
├── pyproject.toml                  ← hatchling, FastAPI, astrapy (pending)
├── README.md                       ← you are here
├── src/workbench/
│   ├── __init__.py                 ← version
│   ├── __main__.py                 ← `python -m workbench`
│   ├── cli.py                      ← `workbench` entry point (uvicorn wrapper)
│   ├── app.py                      ← FastAPI app factory + middleware + error handler
│   ├── config.py                   ← env-var resolution (ASTRA_*, WORKBENCH_*)
│   ├── errors.py                   ← ApiError + subclasses + HTTP mapping
│   ├── models.py                   ← Pydantic models mirroring TS types
│   └── routes/                    ← scaffold; align with TS routes when implemented
│       ├── workspaces.py
│       ├── services.py            ← chunking / embedding / reranking
│       ├── knowledge_bases.py
│       └── documents.py
└── tests/
    ├── conftest.py                 ← FastAPI + mock-astra wiring
    ├── test_operational.py         ← health/version/request-id (passing)
    └── test_conformance.py         ← scenarios.md runner (xfail until implemented)
```

## Type mirroring

Pydantic models in
[`src/workbench/models.py`](./src/workbench/models.py) mirror the
TypeScript types in
[`../typescript/src/control-plane/types.ts`](../typescript/src/control-plane/types.ts).
When the TS types change, update here in the same PR.

JSON over the wire uses `camelCase` (matching TS). Python-side
attributes use `snake_case`. The Pydantic `alias_generator=to_camel` +
`populate_by_name=True` config handles the conversion both ways.

## Publishing

Not publishing to PyPI yet. For now, run from source or build and
deploy the container image. PyPI release will gate on:

1. Conformance passing against a real Astra endpoint (not just mock).
2. All Phase 1a scenarios implemented.
3. A release workflow in `.github/workflows/`.

## House rules

- Use [`ruff`](https://docs.astral.sh/ruff/) for lint + format:
  `ruff check . && ruff format .`
- Use [`mypy`](https://mypy.readthedocs.io/) for type checking:
  `mypy src`
- No `print()` — use `logging` for telemetry.
- Route handlers stay thin; push domain logic into `workbench/astra.py`
  (to be created).
