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
		title: "Faster chat history on long conversations",
		summary:
			"Opening a conversation now loads its messages a page at a time with a keyset cursor instead of pulling the whole transcript on every request — on every storage backend. Long-running chats stay snappy and the runtime no longer materialises the entire conversation just to show the latest turns. The wire shape is unchanged, so existing clients keep working.",
	},
	{
		title: "Safer web access for agents",
		summary:
			"The built-in fetch tool now resolves a URL's hostname and checks every resolved address before connecting, closing a path where a public-looking domain could point an agent at an internal or cloud-metadata address. Private, loopback, and metadata targets are refused — by name, by literal IP, and now by what the name actually resolves to.",
		link: {
			label: "Configure an agent's tools",
			href: "/agents",
		},
	},
	{
		title: "Smoother restarts",
		summary:
			"During a graceful shutdown, live job-progress streams now close cleanly so the browser reconnects to the next replica (or the restarted process) and picks up where it left off via Last-Event-ID — no more streams hanging until the shutdown timeout. Rolling restarts and deploys are quieter as a result.",
	},
];
