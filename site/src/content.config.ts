import { defineCollection } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";

// The site's `docs` content collection is generated at build time
// from `<repo>/docs/*.md` via `npm run stage-docs` (chained as a
// `predev` / `prebuild` script). The staging copy at
// `<site>/.docs-staged/` adds the minimal Starlight frontmatter
// (`title:`) the markdown source intentionally doesn't carry —
// keeping the canonical files browseable on github.com without
// site-specific noise.
//
// Slugs are file basenames (`architecture.md` → `architecture`).
// The sidebar in `astro.config.mjs` references those slugs.
// `index.astro` (the splash landing) lives at
// `src/pages/index.astro` and is rendered outside this collection.
export const collections = {
	docs: defineCollection({
		loader: glob({
			base: "./.docs-staged",
			pattern: "*.md",
		}),
		schema: docsSchema(),
	}),
};
