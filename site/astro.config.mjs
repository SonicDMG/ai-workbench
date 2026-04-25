// @ts-check

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// AI Workbench — docs site config.
//
// The narrative docs live at the repo root in `docs/` so they stay
// browseable on GitHub. Starlight renders them via a `srcDir`
// override on its content collection (see `src/content.config.ts`)
// — no copy step, no symlinks, the markdown files render twice
// (GitHub + this site) without a sync seam.
//
// `site` and `base` are wired for project-pages hosting at
// `https://datastax.github.io/ai-workbench/`. Override via
// `SITE_URL` / `SITE_BASE` for custom domains or fork deployments.

const SITE_URL = process.env.SITE_URL ?? "https://datastax.github.io";
const SITE_BASE = process.env.SITE_BASE ?? "/ai-workbench";

export default defineConfig({
	site: SITE_URL,
	base: SITE_BASE,
	integrations: [
		starlight({
			title: "AI Workbench",
			description:
				"An HTTP runtime that sits in front of Astra DB, with workspaces, catalogs, vector stores, ingest, and a browser playground.",
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/datastax/ai-workbench",
				},
			],
			editLink: {
				baseUrl: "https://github.com/datastax/ai-workbench/edit/main/docs/",
			},
			lastUpdated: true,
			pagination: true,
			// Sidebar order is curated rather than alphabetical so first-time
			// readers get a good top-down path. The slugs match filenames in
			// `docs/`.
			sidebar: [
				{
					label: "Start here",
					items: [
						{ label: "Architecture", slug: "architecture" },
						{ label: "Green boxes (multi-runtime)", slug: "green-boxes" },
						{ label: "Workspaces", slug: "workspaces" },
						{ label: "Configuration", slug: "configuration" },
					],
				},
				{
					label: "HTTP surface",
					items: [
						{ label: "API spec", slug: "api-spec" },
						{ label: "Authentication", slug: "auth" },
						{ label: "Conformance", slug: "conformance" },
					],
				},
				{
					label: "UX",
					items: [{ label: "Playground", slug: "playground" }],
				},
				{
					label: "Project",
					items: [{ label: "Roadmap", slug: "roadmap" }],
				},
				// `Design notes` (cross-replica-jobs.md) joins the sidebar
				// once #70 lands on main; the slug must exist in the docs
				// collection or Starlight refuses to build.
			],
			customCss: ["./src/styles/landing.css"],
		}),
	],
});
