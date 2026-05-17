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
		title: "aiw CLI",
		summary:
			"Drive the workbench from your terminal: `aiw login`, `workspace`, `kb`, `doc upload`, `search`, `agent`, `chat`, `job`. Profiles live in ~/.aiw/config.json.",
		link: {
			label: "Read the CLI README",
			href: "https://github.com/datastax/ai-workbench/tree/main/packages/aiw-cli#readme",
		},
	},
	{
		title: "MCP read tools",
		summary:
			"External MCP clients can now discover workspace agents via `list_agents` / `get_agent` without leaving the protocol. Ingest + delete write tools already shipped earlier.",
		link: {
			label: "MCP docs",
			href: "https://github.com/datastax/ai-workbench/blob/main/docs/mcp.md",
		},
	},
	{
		title: "RLAC on Documents (Preview)",
		summary:
			"Enable Row-Level Access Control per workspace from the settings page. Define principals, run the policy preview, watch decisions in the audit log. API + audit shape may still change before GA.",
		link: {
			label: "Read the Preview guide",
			href: "https://github.com/datastax/ai-workbench/blob/main/docs/rlac-preview.md",
		},
	},
	{
		title: "Skeleton loaders + a11y polish",
		summary:
			"List and table pages render shimmer placeholders instead of layout-jumping spinners; shared loading / error / empty states announce themselves through live regions for assistive tech.",
	},
];
