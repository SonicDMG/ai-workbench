#!/usr/bin/env node
/**
 * Stage <repo>/docs/*.md into <repo>/site/.docs-staged/ with the
 * minimal Starlight frontmatter (`title`) prepended.
 *
 * Why: the docs at <repo>/docs/ are the source-of-truth on GitHub.
 * They aren't allowed to carry Starlight-specific YAML frontmatter
 * because that's noise to anyone reading on github.com. This script
 * generates a Starlight-friendly copy at build time. The copy is
 * gitignored; the site's content collection loads from it via the
 * standard Astro glob loader, which gets us all of Starlight's
 * markdown rendering, MDX hooks, asset handling, and digest-based
 * incremental builds for free.
 *
 * Title comes from the first `# H1` line. README.md is the docs/
 * folder index (TOC), not a content page, so it's skipped.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// site/scripts/ → repo root is two levels up.
const REPO_ROOT = resolve(HERE, "../..");
const DOCS_SRC = resolve(REPO_ROOT, "docs");
const STAGED_DIR = resolve(HERE, "..", ".docs-staged");
const SKIP = new Set(["README.md"]);

function extractTitle(body, fallback) {
	for (const line of body.split("\n")) {
		const m = /^#\s+(.+?)\s*$/.exec(line);
		if (m) return m[1];
	}
	return fallback;
}

function escapeYamlString(s) {
	// Quote with double quotes, escape backslashes and double quotes.
	return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

await rm(STAGED_DIR, { recursive: true, force: true });
await mkdir(STAGED_DIR, { recursive: true });

const entries = await readdir(DOCS_SRC, { withFileTypes: true });
let count = 0;
for (const entry of entries) {
	if (!entry.isFile()) continue;
	if (extname(entry.name) !== ".md") continue;
	if (SKIP.has(entry.name)) continue;
	const src = join(DOCS_SRC, entry.name);
	const body = await readFile(src, "utf8");
	const title = extractTitle(body, entry.name.replace(/\.md$/, ""));
	const frontmatter = `---\ntitle: ${escapeYamlString(title)}\n---\n\n`;
	const dst = join(STAGED_DIR, entry.name);
	await writeFile(dst, frontmatter + body, "utf8");
	count += 1;
}

// Synthetic 404 entry. Starlight registers `/404.html` as a route
// that looks up a docs collection entry with id `404`; if there's no
// such entry the build runs into a Starlight-internal schema crash
// on this dependency tree. Materializing one here gives Starlight a
// well-formed entry to render. `sidebar.hidden` keeps it out of nav.
await writeFile(
	join(STAGED_DIR, "404.md"),
	`---
title: "Not found"
template: splash
sidebar:
  hidden: true
hero:
  title: "404"
  tagline: "We couldn't find the page you were looking for."
  actions:
    - text: "Back to the docs"
      link: "/"
      variant: primary
      icon: left-arrow
---
`,
	"utf8",
);

console.log(`stage-docs: wrote ${count + 1} pages to ${STAGED_DIR}`);
