# syntax=docker/dockerfile:1.7
#
# AI Workbench default ship image: TypeScript runtime + web UI in one
# container. The runtime serves the compiled UI out of /app/public
# (see src/ui/assets.ts); `/` returns the app, `/api/v1/*` the JSON
# API, `/docs` the OpenAPI reference.
#
# Build context is expected to be the repo root so both
# `runtimes/typescript/` and `apps/web/` are reachable.
#
# The base image is pinned by digest so a re-tagged `node:22-alpine`
# upstream cannot silently change the build. Refresh the digest with:
#   docker pull node:22-alpine
#   docker images --digests node:22-alpine
# and update all three FROM lines below in lockstep.

ARG NODE_BASE=node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f

# ---------- UI build ----------
FROM ${NODE_BASE} AS ui-build
WORKDIR /ui
# `.npmrc` carries `legacy-peer-deps=true` to satisfy the
# openapi-typescript@7 → typescript@^5 peer constraint on a
# typescript@^6 project (see the file's own comment for context).
# The trailing `*` keeps the COPY non-fatal if the file is removed
# in a future cleanup.
COPY apps/web/package.json apps/web/package-lock.json* apps/web/.npmrc* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi
COPY apps/web/. ./
RUN npm run build

# ---------- Runtime build ----------
FROM ${NODE_BASE} AS rt-build
WORKDIR /app
COPY runtimes/typescript/package.json runtimes/typescript/package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi
COPY runtimes/typescript/tsconfig.json runtimes/typescript/tsconfig.build.json ./
COPY runtimes/typescript/src ./src
RUN npx tsc -p tsconfig.build.json

# ---------- Runtime image ----------
FROM ${NODE_BASE} AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY runtimes/typescript/package.json runtimes/typescript/package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi && \
    npm cache clean --force && \
    # The runtime CMD is `node dist/root.js`; npm/npx aren't used at
    # runtime. Drop the global npm install so its vendored deps
    # (picomatch / brace-expansion / ip-address / etc.) don't get
    # picked up by image SBOM / vulnerability scans.
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=rt-build /app/dist ./dist
COPY --from=ui-build /ui/dist ./public
COPY runtimes/typescript/examples ./examples

ARG APP_VERSION=0.0.0
ARG APP_COMMIT=unknown
ARG APP_BUILD_TIME=unknown
# `examples/workbench.yaml` is the dev-host default (file-backed for
# `npm run dev` persistence); `examples/workbench.memory.yaml` is the
# hermetic in-memory config that makes a container restart return to
# a clean slate. Operators who want persistence across container
# restarts mount a writable volume and override WORKBENCH_CONFIG with
# a yaml whose `controlPlane.driver: file root: /var/lib/workbench`
# (or point at astra). See docs/configuration.md.
ENV APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT} \
    APP_BUILD_TIME=${APP_BUILD_TIME} \
    WORKBENCH_CONFIG=/app/examples/workbench.memory.yaml

# Pre-create the data dir owned by `node` (uid 1000). Named volumes
# copy ownership from the image's mount point on first use, so a fresh
# `workbench-data` volume mounted at /var/lib/workbench (compose
# default) comes up writable by the non-root runtime user instead of
# the Docker default root:root — see docs/docker.md troubleshooting
# for volumes created by older images.
RUN mkdir -p /var/lib/workbench && chown node:node /var/lib/workbench

EXPOSE 8080
USER node

# `wget` ships in node:22-alpine. The runtime's /healthz returns 200
# once the HTTP server is listening; /readyz also gates on config
# load, but the simpler liveness signal is what `docker ps` reports.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["node", "dist/root.js"]
