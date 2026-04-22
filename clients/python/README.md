# workbench-astra-client (Python)

Python port of the AI Workbench Astra client. Wraps the Astra Data API
for `wb_*` control-plane tables and vector-store collections, matching
the behavior of the canonical TypeScript client byte-for-byte (enforced
by [`../conformance/`](../conformance/)).

## Status

**Scaffold.** The public shape is defined; every method raises
`NotImplementedError("... — scaffolded")`. Fill in each one, re-run the
conformance tests, and iterate.

## Quickstart

```bash
# 1. From clients/python/ — install in editable mode with dev deps.
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

# 2. From the repo root, in a separate terminal — start the mock Astra
# server. Leave this running while you iterate.
npm run conformance:mock

# 3. Back in your Python venv — run the conformance tests. You'll see
# 3 xfail (expected — the scaffold raises NotImplementedError) plus
# 1 passing harness sanity check.
pytest
```

When you're done for the day, `podman` or `docker` isn't needed — the
mock runs as a plain Node process.

## Where to start implementing

Each `NotImplementedError` in
[`src/workbench_astra_client/control_plane.py`](./src/workbench_astra_client/control_plane.py)
corresponds to one step in
[`../conformance/scenarios.md`](../conformance/scenarios.md). Suggested
order:

1. `Workspaces.create` — scenario 1 step 1. Simplest possible HTTP call.
2. `Workspaces.list` / `Workspaces.get` / `Workspaces.update` /
   `Workspaces.delete` — completes scenario 1.
3. `Catalogs.*` — completes scenario 2.
4. `VectorStores.*` — completes scenario 3.

Each time you flip a test green, remove its `@pytest.mark.xfail`
decorator in
[`tests/test_conformance.py`](./tests/test_conformance.py) (the
`xfail(strict=True)` means a passing-without-removing will fail CI — so
you can't forget).

## HTTP transport

Use [`_http.py`](./src/workbench_astra_client/_http.py) — it's an
`httpx.Client` with the standard Astra Data API headers
(`content-type: application/json`, `token: ...`) already injected. If
you add a new header, add it to every other language client in the same
PR and regenerate fixtures (the TS client is the canonical source of
truth; `npm run conformance:regenerate` will land with PR-1a.2).

When you're ready to talk to a real Astra endpoint, swap httpx for
[`astrapy`](https://github.com/datastax/astrapy) — but for conformance
against the mock, raw httpx is the right choice.

## Structure

```
clients/python/
├── pyproject.toml                               ← hatchling, py3.11+
├── README.md                                    ← you are here
├── src/workbench_astra_client/
│   ├── __init__.py                              ← re-exports WorkbenchAstraClient + record types
│   ├── client.py                                ← top-level facade
│   ├── control_plane.py                         ← wb_* table CRUD (scaffold)
│   ├── data_plane.py                            ← collection CRUD + search (Phase 1b scaffold)
│   ├── types.py                                 ← frozen dataclasses mirroring TS types
│   └── _http.py                                 ← shared httpx transport
└── tests/
    ├── conftest.py                              ← mock_url, reset_mock, client, captured
    └── test_conformance.py                      ← scenarios.md runner
```

## Type mirroring

Python type definitions in
[`src/workbench_astra_client/types.py`](./src/workbench_astra_client/types.py)
track the TypeScript definitions in
[`../../src/control-plane/types.ts`](../../src/control-plane/types.ts).
When TS types change, update here in the same PR.

Naming convention:
- TS `camelCase` → Python `snake_case`.
- TS `Record<string, string>` → Python `dict[str, str]`.
- TS `readonly` → Python `@dataclass(frozen=True)`.

## Conformance test behavior

[`tests/test_conformance.py`](./tests/test_conformance.py) runs every
scenario against the mock and compares captured HTTP payloads to
fixtures in [`../conformance/fixtures/`](../conformance/fixtures/).

Until fixtures exist (they ship with PR-1a.2 alongside the canonical TS
client), the test asserts only that each scenario runs without
exception. Byte-diff assertions flip on automatically when fixtures
appear.

## Publishing

Not publishing to PyPI yet. For now, the package is `pip install
-e '.[dev]'` from the checkout directory. PyPI release will gate on:

1. Conformance against real Astra (not just the mock) passing.
2. All Phase 1a scenarios implemented.
3. Release workflow added to `.github/workflows/`.

## Asks

- Use [`ruff`](https://docs.astral.sh/ruff/) for lint + format:
  `ruff check . && ruff format .`.
- Use [`mypy`](https://mypy.readthedocs.io/) for type checking:
  `mypy src`.
- No `print()` statements — use `logging` where telemetry is needed.
