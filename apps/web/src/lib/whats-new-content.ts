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
		title: "Access control that holds — even in agent chat",
		summary:
			"Row-level access control now applies on every read path, including an agent's retrieval. Turn it on for a workspace, define principals, and ingest documents with a visibility — and a principal's agent can only retrieve what that principal is allowed to see. A new Access Control card, Principals panel, and Policy Audit panel live in workspace settings.",
		link: {
			label: "Open a workspace",
			href: "/",
		},
	},
	{
		title: "Narrowly-scoped API keys",
		summary:
			'Mint keys that can do exactly one thing — ingest-only, knowledge-base admin, audit-read, tool-invoke, and more — with the new "Custom (advanced)" scope picker. Existing read / write / manage keys keep working unchanged: the coarse tiers are supersets of the fine scopes, so there\'s no migration. The new `aiw key` CLI command mints and revokes them from a terminal.',
	},
	{
		title: "Agents can call external MCP tools — under a scope",
		summary:
			"Register an external MCP server and an agent can call its tools, but only when the calling key carries the new `tools:invoke` scope. Every call is audited, and a call without the scope is refused rather than executed. The agent form groups tools by server, shows their required arguments, and warns about saved tools that no longer resolve.",
	},
];
