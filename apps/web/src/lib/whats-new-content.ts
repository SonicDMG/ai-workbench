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
		title: "Row-level access control no longer locks you out of the web app",
		summary:
			"Enabling RLAC on a workspace used to make its knowledge bases unreadable from the browser — opening one errored immediately with a missing-principal error, even though a default admin principal had already been created. Fixed: the app now identifies you as that admin principal automatically, so an RLAC-enabled workspace is usable right away. A new discreet 'view as' control on the knowledge-base explorer lets you preview a knowledge base as any principal — to see exactly what they can.",
		link: {
			label: "Open a workspace",
			href: "/",
		},
	},
];
