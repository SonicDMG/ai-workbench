# syntax=docker/dockerfile:1.7
#
# AI Workbench default ship image: TypeScript runtime + web UI in one
# container. The runtime serves the compiled UI out of /app/public
# (see src/ui/assets.ts); `/` returns the app, `/api/v1/*` the JSON
# API, `/docs` the OpenAPI reference.
#
# Build context is expected to be the repo root so both
# `runtimes/typescript/` and `apps/web/` are reachable.

# ---------- UI build ----------
FROM node:22-alpine AS ui-build
WORKDIR /ui
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi
COPY apps/web/. ./
RUN npm run build

# ---------- Runtime build ----------
FROM node:22-alpine AS rt-build
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
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY runtimes/typescript/package.json runtimes/typescript/package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi && \
    npm cache clean --force

COPY --from=rt-build /app/dist ./dist
COPY --from=ui-build /ui/dist ./public
COPY runtimes/typescript/examples ./examples

ARG APP_VERSION=0.0.0
ARG APP_COMMIT=unknown
ARG APP_BUILD_TIME=unknown
ENV APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT} \
    APP_BUILD_TIME=${APP_BUILD_TIME} \
    WORKBENCH_CONFIG=/app/examples/workbench.yaml

EXPOSE 8080
USER node

CMD ["node", "dist/root.js"]
