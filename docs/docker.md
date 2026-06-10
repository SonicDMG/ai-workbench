# Running AI Workbench with Docker

The published container image bundles the TypeScript runtime and the
React web UI into a single process on port `8080`. This guide covers
the end-user "try it" path; for source-from-Node development see the
top-level [`README.md`](../README.md).

## Quickstart

```bash
curl -O https://raw.githubusercontent.com/datastax/ai-workbench/main/docker-compose.yml
docker compose up
```

Open `http://localhost:8080`. The first
`compose up` pulls
`ghcr.io/datastax/ai-workbench:latest` (multi-arch — amd64 and
arm64). Subsequent boots are near-instant.

### Without compose

If you'd rather not use compose:

```bash
docker run --rm \
  -p 8080:8080 \
  -v workbench-data:/var/lib/workbench \
  -e WORKBENCH_CONFIG=/app/examples/workbench.docker.yaml \
  ghcr.io/datastax/ai-workbench:latest
```

Same behavior: file-backed persistence on the named volume, healthcheck
baked into the image.

## Persistence

The compose stack mounts a named volume `workbench-data` at
`/var/lib/workbench`. The bundled
[`workbench.docker.yaml`](../runtimes/typescript/examples/workbench.docker.yaml)
pins the control plane to the `file` driver rooted there, so
workspaces / agents / KBs / jobs survive `docker compose down`.

### Where the volume lives

```bash
docker volume inspect ai-workbench_workbench-data
```

On Docker Desktop this is inside the VM disk; on Linux Engine it's
under `/var/lib/docker/volumes/`.

### Backup and restore

```bash
# Backup
docker run --rm \
  -v ai-workbench_workbench-data:/data \
  -v "$(pwd):/backup" \
  alpine tar czf /backup/workbench-backup.tgz -C /data .

# Restore (into a fresh stack)
docker compose down -v
docker compose up -d --no-start
docker run --rm \
  -v ai-workbench_workbench-data:/data \
  -v "$(pwd):/backup" \
  alpine tar xzf /backup/workbench-backup.tgz -C /data
docker compose up -d
```

### Reset to a clean slate

```bash
docker compose down -v
docker compose up -d
```

`-v` removes the named volume; the stack restarts with no workspaces.

## Configuration

The runtime reads `workbench.yaml` for backend selection and per-feature
toggles (auth, chat, MCP). Environment variables override matching keys
at boot — see [`docs/configuration.md`](configuration.md) for the full
schema.

Precedence (highest wins): shell env > container env > `.env` >
`workbench.yaml` defaults.

### Astra DB credentials

Workspace-scoped Astra credentials resolve from process env at use
time, so adding them to `.env` is enough — no yaml edit required:

```bash
# .env (next to docker-compose.yml)
ASTRA_DB_API_ENDPOINT=https://<db-id>-<region>.apps.astra.datastax.com
ASTRA_DB_APPLICATION_TOKEN=AstraCS:...
```

`docker compose up -d --force-recreate` reloads env.

When you create a workspace in the UI / API with
`credentialsRef: { token: "env:ASTRA_DB_APPLICATION_TOKEN" }`, the
runtime resolves the ref from these vars.

> Note: the bundled `workbench.docker.yaml` pins the **control plane**
> (where workspace / agent / KB metadata is stored) to the local file
> volume. To put the control plane *itself* in Astra, use the override
> file pattern below to point `WORKBENCH_CONFIG` at a custom yaml with
> `controlPlane: { driver: astra, ... }`.

### OpenRouter chat

Generate a key at https://openrouter.ai/keys, add it to `.env`:

```bash
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # secret-scan: allow
```

One key reaches OpenRouter's 300+ models. For fully offline use,
point the `chat:` block at the `ollama` provider instead — Ollama
runs locally and needs no key.

Then either uncomment the `chat:` block in the bundled
`workbench.docker.yaml` (via the override pattern) or bind-mount a
custom yaml with `chat:` enabled. Without `chat:` and no agent-level
LLM binding, `POST .../messages` returns `503 chat_disabled`.

## Override file pattern

`docker-compose.override.yml` (gitignored) is merged on top of
`docker-compose.yml` automatically. Use it for the common deviations:

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
# edit, then:
docker compose up -d --force-recreate
```

The [example file](../docker-compose.override.yml.example) shows
three pre-canned snippets:

1. **Build from source** — replace `image:` with a `build:` block
   pointing at `runtimes/typescript/Dockerfile`.
2. **Bind-mount a custom yaml** — swap `WORKBENCH_CONFIG` to a path
   under `/etc/workbench/` and bind-mount your file there read-only.
3. **Bump log verbosity** — set `LOG_LEVEL=debug`.

## Upgrading

```bash
docker compose pull
docker compose up -d --remove-orphans
```

`pull` fetches the newest `:latest` (or whatever tag you've pinned via
`AI_WORKBENCH_TAG`). Recreating preserves the named volume.

To pin a version:

```bash
AI_WORKBENCH_TAG=0.3.0 docker compose up -d
```

## Healthcheck

The image ships with a `HEALTHCHECK` that hits `/healthz` every 30s.
Status surfaces in `docker ps`:

```bash
docker compose ps
# NAME            STATUS                    PORTS
# ai-workbench    Up 2 minutes (healthy)    0.0.0.0:8080->8080/tcp
```

`/readyz` adds config-load gating; use it from external probes that
need to know the runtime finished startup.

## Troubleshooting

**Port already in use.** Override the host-side port:

```bash
AI_WORKBENCH_PORT=9090 docker compose up -d
```

**Volume permission denied.** The image pre-creates
`/var/lib/workbench` owned by `node` (uid 1000), so a *fresh* named
volume initializes writable on first use. If your volume was created
by an image older than 0.5.4 (which left the mount point root-owned)
or with a different uid, workspace creation fails with permission
errors until you fix the ownership:

```bash
docker run --rm -v ai-workbench_workbench-data:/data alpine \
  chown -R 1000:1000 /data
```

(The image runs as `node` = uid 1000. Prefer this one-time chown over
running the container as root via a `user: "0:0"` compose override.)

**View logs.**

```bash
docker compose logs -f workbench
```

**Pull denied / unauthorized.** New GHCR packages default to private,
so right after the first release the image isn't pullable without
auth. A DataStax org member with `admin:packages` rights flips it with
the bundled helper:

```bash
# One-time per gh login:
gh auth refresh -s admin:packages

# After the first release lands:
npm run release:make-public
# → "Flipped to public. `docker pull` now works without auth."
```

The script ([`scripts/ghcr-make-public.mjs`](../scripts/ghcr-make-public.mjs))
is idempotent — re-running on an already-public package is a no-op —
and exits with a hint if the package doesn't exist yet (no release
has shipped). Until the flip happens, authenticate manually:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <user> --password-stdin
```

**Manifest unknown / no matching arch.** The `:latest` tag is multi-arch
(amd64 + arm64) as of the first release that ships this guide. Older
tags may be amd64-only — pin a newer tag or rebuild from source via
the override file.
