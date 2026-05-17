---
"@ai-workbench/cli": minor
---

Web: add an in-app "What's new" modal that auto-opens once per `APP_VERSION` (dismissal persists in `localStorage` under `aiw:wn:${APP_VERSION}`) and stays available on demand via a sparkles trigger in the header. Content is a hand-curated typed array in `apps/web/src/lib/whats-new-content.ts` so the doc isn't parsed at runtime. Plus three hover tooltips on commonly-missed operator actions — KB explorer **Ingest**, Agents **From template**, and API-keys **New key** — to improve discoverability without adding a Radix Tooltip dependency. The runtime is unchanged.
