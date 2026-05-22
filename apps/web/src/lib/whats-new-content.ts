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
		title: "First-run setup wizard",
		summary:
			"Fresh installs land on a guided onboarding flow that captures Astra and HuggingFace credentials, writes them to a managed `.env` in the workbench-data volume (mode 0600, allow-listed keys only), and restarts the runtime so the new values take effect — no shell access required.",
		link: {
			label: "Open onboarding",
			href: "/onboarding",
		},
	},
	{
		title: "System status page",
		summary:
			"New /status route renders live traffic-light cards for the control-plane probe, chat-provider probe, ingest queue, and the last 100 error envelopes (no PII). Polled every 10 seconds so a stuck install is visible without grepping container logs.",
		link: {
			label: "Open /status",
			href: "/status",
		},
	},
	{
		title: "Error envelopes carry remediation hints",
		summary:
			"Every API error now ships with a one-line `hint` and a `docs` link drawn from a 67-entry registry. The web UI surfaces them in toasts; the new `aiw doctor --explain <code>` prints the long-form entry; the full catalog lives at docs/errors.md.",
		link: {
			label: "Browse the error catalog",
			href: "https://github.com/datastax/ai-workbench/blob/main/docs/errors.md",
		},
	},
	{
		title: "CLI: aiw doctor, status, profile, completion",
		summary:
			"`aiw doctor` runs a PASS/WARN/FAIL pre-flight checklist; `aiw status` is the one-line health probe; `aiw profile {ls,use,rm}` manages stored credential profiles; `aiw completion {bash,zsh,fish}` emits a shell completion script. Every command supports stable JSON output and documented exit codes.",
		link: {
			label: "Read the CLI README",
			href: "https://github.com/datastax/ai-workbench/tree/main/packages/aiw-cli#readme",
		},
	},
	{
		title: "Curated Prometheus metrics + Grafana starter",
		summary:
			"Five new metric families land at /metrics: chat requests by provider + outcome, stream tokens, ingest documents, search requests by mode, search latency. A drop-in Grafana dashboard JSON ships at docs/observability/grafana-workbench.json.",
		link: {
			label: "Production guide",
			href: "https://github.com/datastax/ai-workbench/blob/main/docs/production.md",
		},
	},
	{
		title: "Opt-in anonymous telemetry",
		summary:
			"Off by default. Enable with WORKBENCH_TELEMETRY=1 / AIW_TELEMETRY=1 and (optionally) point at a sink. Strictly categorical fields only — install id, version, event name, error code. No request bodies, paths, names, or secrets ever leave the process.",
		link: {
			label: "Event catalog + opt-out",
			href: "https://github.com/datastax/ai-workbench/blob/main/docs/telemetry.md",
		},
	},
	{
		title: "Conformance now covers chat",
		summary:
			"A new FixtureChatService replays scripted token streams so the SSE happy path + agent message CRUD are pinned in the cross-runtime conformance harness. SSE response bodies normalize into a deterministic array of {event, data} records.",
	},
];
