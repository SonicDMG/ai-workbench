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
		title: "Deleting a workspace now cleans up everything",
		summary:
			"Removing a workspace used to leave its MCP servers, access principals, and policy-audit rows behind. Deletion now cascades to all of them on every storage backend. On Astra it is self-healing: if a delete is interrupted partway, the workspace stays put and the cleanup completes on retry instead of stranding orphaned records — and an optional startup pass can sweep up orphans left by older versions.",
		link: {
			label: "Manage workspaces",
			href: "/",
		},
	},
	{
		title: "Secrets stay out of your logs",
		summary:
			"Structured log output now redacts secret- and token-shaped values automatically, so API keys and bootstrap tokens no longer slip into the logs you ship to an aggregator.",
	},
	{
		title: "A tighter setup & rescue surface",
		summary:
			"The first-run setup and rescue endpoints now gate every state-changing route behind the setup auth-gate, and the bootstrap-token check is constant-time so it can't be guessed by timing. Bounded readiness probes and chat request timeouts keep the runtime steadier under load and during restarts.",
	},
];
