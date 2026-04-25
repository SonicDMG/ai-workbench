# `site/` — landing page + docs site

Astro Starlight scaffold that renders the project landing page and
the markdown docs at `<repo>/docs/` as a single static site for
GitHub Pages (or any static host).

## Status: **scaffolded, not yet wired to deploy**

This directory is the result of a design exploration (PR #N — see
the PR description for the full options analysis). The shape is in
place:

- Astro 5 + Starlight integration
- Custom `npm run stage-docs` step that copies `<repo>/docs/*.md`
  into `site/.docs-staged/` with auto-generated `title:` frontmatter
  (so the source-of-truth markdown stays clean for github.com)
- Plain Astro landing page at `src/pages/index.astro` (intentionally
  not using `StarlightPage` — see "Known issues" below)
- Sidebar curated by section in `astro.config.mjs`

`npm run dev` works for the landing page today. **Full Starlight
docs rendering is currently blocked** by an upstream zod v3 / v4
mismatch in the Starlight + Astro + sitemap dependency tree:

```
Cannot read properties of undefined (reading '_zod')
  at inst._zod.parse (zod/v4/core/schemas.js:1398:46)
  generating static routes ▶ @astrojs/starlight/routes/static/404.astro
```

Re-test against newer Starlight + Astro releases (or the
zod 4 migration completing across the Astro ecosystem) before
flipping the deploy on. Tracked in the PR description.

### Path forward — three options

1. **Wait for upstream.** The Astro ecosystem is mid-zod-v3-to-v4
   migration; the breakage is well-known and being worked. Picking
   this up in 2–3 weeks may Just Work.
2. **Switch to VitePress.** Vue-based, mature, designed for
   exactly this use case, doesn't share Astro's current zod
   instability. Probably the lowest-risk path if a docs site is
   wanted soon. The `stage-docs.mjs` script ports cleanly; the
   landing page would be rewritten as a Vue component or a
   markdown page with VitePress's `home` layout.
3. **Drop Starlight, keep Astro.** Render docs via Astro's plain
   markdown page route + a hand-rolled layout. Cheaper than
   VitePress at the cost of nicer-out-of-the-box features
   (search, theme switcher, mobile sidebar, etc).

Pick one and finish wiring the GitHub Pages deploy. Until then,
the landing page (`src/pages/index.astro`) is self-contained and
could be deployed standalone if a marketing page is the bigger
priority.

## Architecture decisions

- **Markdown source-of-truth stays in `<repo>/docs/`.** Doc PRs
  shouldn't have to choose between rendering on github.com and
  rendering on the docs site — both should work from the same
  files.
- **Stage-don't-symlink.** A `predev` / `prebuild` script copies
  the docs into `.docs-staged/` (gitignored). Symlinks would work
  on Unix but are awkward on Windows + some CI runners.
- **Custom landing, Starlight chrome on docs.** `src/pages/index.astro`
  is a hand-rolled splash because StarlightPage's frontmatter schema
  validation is part of the dependency-tree zod issue blocking the
  full build. The landing has its own self-contained styling
  (~150 lines of CSS) so it doesn't depend on Starlight's theme.
  Doc pages render via Starlight as soon as the upstream issue
  resolves.

## Layout

```
site/
├── astro.config.mjs           # Starlight integration, sidebar
├── src/
│   ├── pages/index.astro      # Custom splash landing page
│   ├── content.config.ts      # Docs collection, glob loader → .docs-staged/
│   └── styles/landing.css     # Brand accents (Starlight pages)
├── scripts/
│   └── stage-docs.mjs         # docs/*.md → .docs-staged/*.md with frontmatter
├── .docs-staged/              # Generated; gitignored
├── dist/                      # Generated; gitignored
└── package.json
```

## Local commands

```bash
npm install                    # Astro + Starlight + sharp
npm run stage-docs             # Generate .docs-staged/ from <repo>/docs/
npm run dev                    # Astro dev server (http://localhost:4321)
npm run build                  # Static site → dist/
npm run preview                # Serve dist/ locally
```

## Hosting

The intended target is **GitHub Pages from the `main` branch's
build artifact**, served at
`https://datastax.github.io/ai-workbench/` (project pages, with
`/ai-workbench` base path). The build accepts `SITE_URL` and
`SITE_BASE` env vars to retarget for forks or custom domains.

A GitHub Actions workflow that deploys on every push to `main` is
**not yet committed** because the OAuth token used to push this
branch lacks the `workflow` scope on `datastax/ai-workbench`. The
recommended workflow file lives in the PR description as a diff;
apply it once `gh auth refresh -s workflow -h github.com` is run.
