import { defineConfig } from "vitepress";

// AI Workbench — VitePress site config.
//
// The narrative docs live at the repo root in `docs/` so they stay
// browseable on GitHub. The build flow is:
//
//   1. `npm run stage-docs` (chained as predev/prebuild) copies
//      `<repo>/docs/*.md` into `<site>/.docs-staged/` and synthesizes
//      `index.md` (the VitePress hero landing).
//   2. `vitepress dev|build .docs-staged` reads from there.
//   3. `.docs-staged/.vitepress/config.ts` is a tiny re-export of
//      THIS file so VitePress finds the config when it's pointed at
//      the staged srcDir.
//
// `base` is wired for project-pages hosting at
// `https://datastax.github.io/ai-workbench/`. Override via
// `SITE_BASE` for custom domains or fork deployments.

const SITE_BASE = process.env.SITE_BASE ?? "/ai-workbench/";

export default defineConfig({
	title: "AI Workbench",
	description:
		"Self-hosted workbench for building, inspecting, and operating retrieval-backed AI applications on DataStax Astra.",
	base: SITE_BASE,
	cleanUrls: true,
	lastUpdated: true,
	// Surface "Edit this page" links pointing back at the canonical
	// markdown source, NOT the staged copy. Editors land directly on
	// the source-of-truth file.
	themeConfig: {
		editLink: {
			pattern: "https://github.com/datastax/ai-workbench/edit/main/docs/:path",
			text: "Edit this page on GitHub",
		},
		socialLinks: [
			{
				icon: "github",
				link: "https://github.com/datastax/ai-workbench",
			},
		],
		// Two-pane navigation. The top nav is intentionally short
		// (Docs / API / Roadmap / GitHub); the section sidebar is
		// where readers actually orient. Sidebar order is curated so
		// first-time readers get a sensible top-down path; slugs
		// match the file basenames in `<repo>/docs/`.
		nav: [
			{ text: "Docs", link: "/overview" },
			{ text: "API", link: "/api-spec" },
			{ text: "Roadmap", link: "/roadmap" },
		],
		sidebar: [
			{
				text: "Start here",
				items: [
					{ text: "Product overview", link: "/overview" },
					{ text: "Architecture", link: "/architecture" },
					{ text: "Green boxes (multi-runtime)", link: "/green-boxes" },
					{ text: "Workspaces", link: "/workspaces" },
					{ text: "Configuration", link: "/configuration" },
				],
			},
			{
				text: "HTTP surface",
				items: [
					{ text: "API spec", link: "/api-spec" },
					{ text: "Authentication", link: "/auth" },
					{ text: "Errors", link: "/errors" },
					{ text: "Conformance", link: "/conformance" },
				],
			},
			{
				text: "Agents & integrations",
				items: [
					{ text: "Agents", link: "/agents" },
					{ text: "MCP server", link: "/mcp" },
					{ text: "Astra CLI discovery", link: "/astra-cli" },
				],
			},
			{
				text: "Operations",
				items: [
					{ text: "Production checklist", link: "/production" },
					{ text: "Docker", link: "/docker" },
					{ text: "Telemetry", link: "/telemetry" },
					{ text: "Audit log", link: "/audit" },
				],
			},
			{
				text: "UX",
				items: [{ text: "Playground", link: "/playground" }],
			},
			{
				text: "Design notes",
				items: [
					{
						text: "Cross-replica jobs",
						link: "/cross-replica-jobs",
					},
					{ text: "Route plugins", link: "/route-plugins" },
					{ text: "Row-level access control", link: "/rlac" },
				],
			},
			{
				text: "Project",
				items: [
					{ text: "What's new in 0.5.2", link: "/whats-new-0.5.2" },
					{ text: "What's new in 0.5.1", link: "/whats-new-0.5.1" },
					{ text: "What's new in 0.5.0", link: "/whats-new-0.5.0" },
					{ text: "What's new in 0.4.3", link: "/whats-new-0.4.3" },
					{ text: "What's new in 0.4", link: "/whats-new-0.4.0" },
					{ text: "Roadmap", link: "/roadmap" },
				],
			},
		],
		footer: {
			message:
				'Released under the <a href="https://github.com/datastax/ai-workbench/blob/main/LICENSE">MIT license</a>.',
			copyright: "Copyright © 2026 DataStax",
		},
	},
	// VitePress complains loudly about dead links by default. The
	// canonical docs are designed for github.com first, so they
	// reference paths outside docs/ (runtimes/, conformance/,
	// .env.example, etc.) that are perfectly valid on the repo but
	// don't exist as site routes. Allow those — they render as 404s
	// on the site, which is honest, but shouldn't fail the build.
	//
	// Doc-internal links (`./api-spec.md`, `[Configuration](/configuration)`,
	// etc.) DO get checked — those are real on the site and rotting
	// them silently would defeat the purpose.
	ignoreDeadLinks: [/^\.\.?\/\.\./, /^\.\.\//],
});
