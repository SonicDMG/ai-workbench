# `site/` — landing page + docs site

VitePress site that renders the project landing page and the canonical
docs at `<repo>/docs/` as a single static site for GitHub Pages.

Live: <https://datastax.github.io/ai-workbench/>

## Status: shipped

Replaces the earlier Astro Starlight scaffold (PR #72). Astro hit an
ecosystem-level zod v3/v4 mismatch in the Starlight integration that
made builds unreliable; VitePress is mature, fast, markdown-first,
and works out of the box with the docs source-of-truth at
`<repo>/docs/`.

## How the build works

1. `npm run stage-docs` (chained as `predev` / `prebuild`) copies
   `<repo>/docs/*.md` into `site/.docs-staged/` (gitignored) and
   synthesizes a VitePress hero `index.md` alongside.
2. `vitepress dev|build .docs-staged` reads from there. The
   `.docs-staged/.vitepress/config.ts` is a one-line re-export of
   the tracked config at `site/.vitepress/config.ts`.

The doc files at `<repo>/docs/` stay clean — no VitePress-specific
frontmatter, no theme directives. They render fine on github.com
and on the site, from the same source.

## Layout

```
site/
├── package.json              # vitepress + vue
├── .vitepress/
│   └── config.ts             # nav, sidebar, base path, edit-link
├── scripts/
│   └── stage-docs.mjs        # docs/*.md → .docs-staged/*.md + index.md
├── .docs-staged/             # generated; gitignored
└── README.md
```

## Local commands

```bash
npm install                   # vitepress + vue
npm run stage-docs            # generate .docs-staged/ from <repo>/docs/
npm run dev                   # http://localhost:5173/ai-workbench/
npm run build                 # → .docs-staged/.vitepress/dist/
npm run preview               # serve dist/ locally
```

## Hosting

Deploys to GitHub Pages via
[`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml)
on every push to `main` that touches `docs/**`, `site/**`, or the
workflow file itself. Independent of the CI workflow — the runtime
test pipeline doesn't gate the docs deploy and vice versa.

**One-time setup** before the first deploy:

1. Settings → Pages → Source = "GitHub Actions" (only needs flipping
   once per repo).
2. The first run on `main` provisions
   `https://datastax.github.io/ai-workbench/`. Subsequent pushes
   redeploy the same URL.

For forks or custom domains, override the base path:

```bash
SITE_BASE=/ npm run build       # root-hosted
SITE_BASE=/forks/ai-wb/ npm build
```

## Adding a new doc page

1. Add the markdown to `<repo>/docs/<slug>.md`. No special
   frontmatter needed — VitePress takes the page title from the
   first H1 line.
2. Add the slug to the sidebar in
   [`site/.vitepress/config.ts`](.vitepress/config.ts) (curated
   ordering, not alphabetical).
3. Re-run `npm run stage-docs && npm run build` locally to verify;
   push to `main` and the deploy workflow handles the rest.

## Adding a custom landing-page component

The hero / features block on `/` is generated inside
`scripts/stage-docs.mjs` (it uses VitePress's `home` layout).
Edit there if you want to change the marketing copy. For
component-level customizations (custom Vue components in markdown,
theme overrides), add them under `.vitepress/theme/` — VitePress
auto-discovers that path.
