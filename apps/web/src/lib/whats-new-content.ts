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
		title: "Agents can call tools",
		summary:
			"Agents now use tools mid-conversation in a bounded multi-step loop: the workspace's own knowledge-base tools, external MCP servers you register, native HTTP fetch + web search, and a read-only Astra Data API query. Pick exactly which tools each agent may use in the agent form; tool calls and their results render as inline expandable cards in chat. Tools beyond the built-ins are opt-in per agent.",
		link: {
			label: "Configure an agent's tools",
			href: "/agents",
		},
	},
	{
		title: "Connect external MCP servers",
		summary:
			"Register Model Context Protocol servers per workspace in Settings, then allow-list their tools onto an agent. The runtime discovers each server's tools at turn time and calls them over the standard MCP protocol — credentials stay behind a secret reference and the server URL is SSRF-guarded.",
		link: {
			label: "Add an MCP server",
			href: "/settings",
		},
	},
	{
		title: "Roles & scoped API keys (RBAC)",
		summary:
			"Access is now gated by coarse roles — viewer (read), editor (read + write), and admin (everything). Issue API keys with a role/scope from the API-keys panel. Admin-only actions (issuing keys, managing RLAC, deleting a workspace) require the new `manage` scope. Heads-up: a pre-0.4.0 read+write key can no longer perform those admin actions — re-mint an admin key.",
		link: {
			label: "Manage API keys & roles",
			href: "/settings",
		},
	},
	{
		title: "Sign in with your IdP (device flow)",
		summary:
			"`aiw login --oidc` adds RFC 8628 device-flow login alongside the API-key paste flow — authorize in the browser, no token to copy. Map your IdP groups/claims to workbench roles with `auth.oidc.roleMapping`.",
		link: {
			label: "Auth & rotation guide",
			href: "https://github.com/datastax/ai-workbench/blob/main/docs/auth.md",
		},
	},
	{
		title: "Durable single-node storage (SQLite)",
		summary:
			'A new `driver: "sqlite"` control-plane backend gives durable, low-overhead persistence for single-node installs — row-level writes instead of the file backend rewriting whole JSON files on every change. Recommended for chat-heavy deployments that don\'t run on Astra.',
		link: {
			label: "Configuration reference",
			href: "https://github.com/datastax/ai-workbench/blob/main/docs/configuration.md",
		},
	},
	{
		title: "More resilient jobs & streaming",
		summary:
			"Background jobs of any kind now resume after a restart (not just ingest), chat streams reconnect with Last-Event-ID, cancelling a chat aborts the in-flight model call, and a dropped stream still records a final assistant turn. Plus every tool call is recorded as a `tool.invoke` audit event.",
	},
];
