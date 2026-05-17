# Convenience shims around the npm scripts in package.json. Everything
# here delegates to npm so there's exactly one source of truth — adding
# a real build step here would just create drift.
#
# Targets:
#   make setup    First-run install: root devDeps + TS runtime + web UI + aiw-cli
#   make start    Build the latest UI and boot the runtime that serves
#                 it on http://localhost:8080. One process, one URL.
#   make dev      API only (no UI build) — for backend-only iteration.
#   make dev-web  Vite dev server on :5173, proxying /api → :8080.
#                 Pair with `make dev` in another terminal for live UI
#                 reload.
#   make cli      Build aiw-cli and link the `aiw` binary globally
#                 (so `aiw login …` is on your $PATH).
#   make check    Lint + typecheck + tests + build (runtime + UI + CLI).
#   make help     This message.

.DEFAULT_GOAL := help
.PHONY: setup start dev dev-web cli check help

setup:
	npm run setup

start:
	npm run start

dev:
	npm run dev

dev-web:
	npm run dev:web

cli:
	npm run build:cli
	cd packages/aiw-cli && npm link

check:
	npm run check

help:
	@grep -E '^#( |$$)' Makefile | sed -E 's/^# ?//'
