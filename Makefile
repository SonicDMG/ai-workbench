# Convenience shims around the npm scripts in package.json. Everything
# here delegates to npm so there's exactly one source of truth — adding
# a real build step here would just create drift.
#
# Targets:
#   make setup    First-run install: root devDeps + TS runtime + web UI
#   make start    Build the latest UI and boot the runtime that serves
#                 it on http://localhost:8080. One process, one URL.
#   make dev      API only (no UI build) — for backend-only iteration.
#   make dev-web  Vite dev server on :5173, proxying /api → :8080.
#                 Pair with `make dev` in another terminal for live UI
#                 reload.
#   make check    Lint + typecheck + tests + build.
#   make help     This message.

.DEFAULT_GOAL := help
.PHONY: setup start dev dev-web check help

setup:
	npm run setup

start:
	npm run start

dev:
	npm run dev

dev-web:
	npm run dev:web

check:
	npm run check

help:
	@grep -E '^#( |$$)' Makefile | sed -E 's/^# ?//'
