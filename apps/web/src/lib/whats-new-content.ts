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
		title: "Bulk delete + parallel ingest in the Knowledge Base Explorer",
		summary:
			'The document table now has checkbox multi-select (select-all follows your filter) with a "Delete selected" action and one confirmation for the whole batch — each document still passes the same row-level access check and audit as a single delete. The ingest queue also runs up to 4 files in parallel (configurable 1–8 in the queue header), with live progress on every running row.',
		link: {
			label: "Read the 0.5.4 notes",
			href: "https://datastax.github.io/ai-workbench/whats-new-0.5.4",
		},
	},
	{
		title: "The Docker quickstart works on the first run",
		summary:
			"Three beta-reported fixes: the data volume is created writable for the non-root container user (no more EACCES on the first workspace), Ollama on the host is reachable from the container (OLLAMA_BASE_URL default, host-gateway mapping, and a new Endpoint base URL field on LLM services), and mock workspaces seed a credential-free embedder so the zero-credential demo ingests out of the box.",
		link: {
			label: "Ollama-on-host setup",
			href: "https://datastax.github.io/ai-workbench/docker",
		},
	},
];
