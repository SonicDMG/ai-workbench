import { Bot, Cog, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAgents } from "@/hooks/useConversations";
import { useChunkingServices, useEmbeddingServices } from "@/hooks/useServices";
import type { Workspace } from "@/lib/schemas";

const FRESH_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DISMISS_KEY_PREFIX = "ai-workbench:dismiss-seeded-callout:";

interface SeededDefaultsCalloutProps {
	readonly workspace: Workspace;
}

/**
 * "We set up these for you" callout shown on the workspace detail
 * page for freshly-created workspaces. Workspace POST auto-seeds a
 * curated set of chunking + embedding services and the Bobby+Maven
 * agents (ADR 0003). Without this callout, the user has no way to
 * know they didn't have to start from zero.
 *
 * Visibility rules:
 * - Workspace's `createdAt` is within the last hour, AND
 * - The user hasn't dismissed it for this workspace.
 *
 * The dismissal is stored in localStorage keyed by `workspaceId` so
 * a deliberate close stays closed across reloads. The freshness
 * window means even a non-dismissed callout naturally fades out
 * after the first hour — we don't want it lingering on workspaces
 * the user has been operating on for days.
 */
export function SeededDefaultsCallout({
	workspace,
}: SeededDefaultsCalloutProps) {
	const dismissKey = `${DISMISS_KEY_PREFIX}${workspace.workspaceId}`;
	// Lazy-init from localStorage so the first render already reflects
	// whether the user dismissed this workspace's callout previously.
	const [dismissed, setDismissed] = useState<boolean>(() => {
		if (typeof window === "undefined") return false;
		try {
			return window.localStorage.getItem(dismissKey) === "1";
		} catch {
			return false;
		}
	});

	const isFresh = useMemo(() => {
		const createdAt = Date.parse(workspace.createdAt);
		if (Number.isNaN(createdAt)) return false;
		return Date.now() - createdAt < FRESH_WINDOW_MS;
	}, [workspace.createdAt]);

	const chunking = useChunkingServices(
		isFresh && !dismissed ? workspace.workspaceId : undefined,
	);
	const embeddings = useEmbeddingServices(
		isFresh && !dismissed ? workspace.workspaceId : undefined,
	);
	const agents = useAgents(
		isFresh && !dismissed ? workspace.workspaceId : undefined,
	);

	useEffect(() => {
		if (!dismissed) return;
		try {
			window.localStorage.setItem(dismissKey, "1");
		} catch {
			// Private-browsing storage exceptions are fine to swallow —
			// at worst the callout reappears on the next reload.
		}
	}, [dismissed, dismissKey]);

	if (!isFresh || dismissed) return null;

	const chunkingCount = chunking.data?.length ?? 0;
	const embeddingCount = embeddings.data?.length ?? 0;
	// Deliberately count *every* seeded agent rather than checking for
	// the specific Bobby/Maven names — operators may have renamed them
	// or replaced the seed set, but as long as something landed they
	// should know.
	const agentCount = agents.data?.length ?? 0;

	// Until at least one of the three queries returns data, render
	// nothing — the callout is misleading if it claims "we set up X"
	// before the queries confirm X exists.
	const anyLoaded =
		chunking.isSuccess || embeddings.isSuccess || agents.isSuccess;
	if (!anyLoaded) return null;

	const summary = buildSummary({ chunkingCount, embeddingCount, agentCount });
	if (!summary) return null;

	return (
		<div
			role="status"
			aria-live="polite"
			className="relative flex items-start gap-3 rounded-lg border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-4 py-3"
		>
			<span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[var(--color-brand-700)]">
				<Sparkles className="h-4 w-4" aria-hidden="true" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium text-[var(--color-brand-900)]">
					We pre-configured this workspace for you
				</p>
				<p className="mt-0.5 text-xs text-[var(--color-brand-800)]">
					{summary} Edit or replace any of them in their respective tabs —
					they're sensible starting defaults, not enforced.
				</p>
				<div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-brand-800)]">
					{chunkingCount > 0 || embeddingCount > 0 ? (
						<span className="inline-flex items-center gap-1">
							<Cog className="h-3 w-3" aria-hidden="true" />
							Services below
						</span>
					) : null}
					{agentCount > 0 ? (
						<span className="inline-flex items-center gap-1">
							<Bot className="h-3 w-3" aria-hidden="true" />
							Agents in the Agents tab
						</span>
					) : null}
				</div>
			</div>
			<Button
				variant="ghost"
				size="icon"
				className="absolute right-1.5 top-1.5 h-6 w-6 text-[var(--color-brand-800)] hover:bg-white/60"
				aria-label="Dismiss callout"
				onClick={() => setDismissed(true)}
			>
				<X className="h-3.5 w-3.5" />
			</Button>
		</div>
	);
}

function buildSummary({
	chunkingCount,
	embeddingCount,
	agentCount,
}: {
	chunkingCount: number;
	embeddingCount: number;
	agentCount: number;
}): string | null {
	const parts: string[] = [];
	if (chunkingCount > 0) {
		parts.push(`${chunkingCount} chunking ${plural(chunkingCount, "service")}`);
	}
	if (embeddingCount > 0) {
		parts.push(
			`${embeddingCount} embedding ${plural(embeddingCount, "service")}`,
		);
	}
	if (agentCount > 0) {
		parts.push(`${agentCount} starter ${plural(agentCount, "agent")}`);
	}
	if (parts.length === 0) return null;
	return `We added ${joinHumanList(parts)} so you can start ingesting and chatting right away.`;
}

function plural(n: number, singular: string): string {
	return n === 1 ? singular : `${singular}s`;
}

function joinHumanList(parts: string[]): string {
	if (parts.length === 1) return parts[0] ?? "";
	if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
	return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
