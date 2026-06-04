/**
 * Highlights surfaced by the in-app "What's new" modal.
 *
 * The list is hand-curated rather than parsed from `CHANGELOG.md` at
 * runtime — the changelog is comprehensive (lots of internal-only
 * entries) and the modal needs to stay short and operator-relevant.
 * Bump `WHATS_NEW_VERSION` whenever you want to re-trigger the
 * auto-open dialog for every user; setting it to `APP_VERSION` keeps
 * the cadence aligned with releases.
 */

import { APP_VERSION } from "./version";

export interface WhatsNewItem {
	readonly title: string;
	readonly summary: string;
	readonly link?: { readonly label: string; readonly href: string };
}

/**
 * Key the localStorage dismissal lives under. Including the version
 * means each release auto-opens the modal again, surfacing new
 * content without re-prompting on every page load.
 */
export const WHATS_NEW_VERSION = APP_VERSION;

/**
 * Public release notes the modal renders. Keep entries short — the
 * modal is a discovery surface, not the changelog. Link out to docs
 * or to the relevant page for the full story.
 */
export const WHATS_NEW_HIGHLIGHTS: readonly WhatsNewItem[] = [
	{
		title: "0.5.3 hardens MCP tooling — no UI changes",
		summary:
			'A security-tooling and dependency-maintenance release on the 0.5 Enterprise Access Control line, with no wire-contract change and no data migration, so nothing in the app\'s behavior changes. AI Workbench now pins the MCP tool definitions it exposes — and those of the external MCP servers it trusts — into a committed lockfile and fails CI if any of them drift (a silent tool "rug-pull"). PDF ingestion also keeps working unchanged across a major pdfjs-dist upgrade.',
		link: {
			label: "Read the 0.5.3 notes",
			href: "https://datastax.github.io/ai-workbench/whats-new-0.5.3",
		},
	},
];
