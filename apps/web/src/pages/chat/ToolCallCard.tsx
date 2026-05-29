import { Loader2, Wrench } from "lucide-react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { formatToolArguments, type ToolCardState } from "@/lib/toolCards";
import { cn } from "@/lib/utils";

/**
 * One inline tool-call card in the conversation transcript.
 *
 * Renders an expandable disclosure per tool call the model made during a
 * streaming turn: the tool name + a live status badge in the summary,
 * the call arguments and (once it lands) the result body inside. Uses
 * native `<details>`/`<summary>` so keyboard + screen-reader disclosure
 * semantics come for free — same approach as `SourcesDisclosure`.
 *
 * The result body is rendered through {@link MarkdownContent} (the same
 * renderer agent replies use) so a tool that returns markdown/JSON code
 * fences lands formatted. Citation linkbacks are off here (empty chunk
 * map) — a tool result isn't a KB citation.
 */
export function ToolCallCard({
	card,
	workspaceId,
}: {
	card: ToolCardState;
	workspaceId: string;
}) {
	const running = card.status === "running";
	const args = formatToolArguments(card.arguments);
	return (
		<details
			className="group rounded-lg border border-slate-200 bg-slate-50/70 text-sm dark:border-slate-700 dark:bg-slate-800/40"
			data-testid="tool-call-card"
		>
			<summary
				className={cn(
					"flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2",
					"font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
					"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
					"[&::-webkit-details-marker]:hidden",
				)}
			>
				<Wrench
					className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500"
					aria-hidden="true"
				/>
				<span className="min-w-0 flex-1 truncate font-mono text-[13px]">
					{card.name}
				</span>
				<ToolStatusBadge running={running} />
			</summary>
			<div className="flex flex-col gap-3 border-t border-slate-200 px-3 py-3 dark:border-slate-700">
				<div className="flex flex-col gap-1">
					<span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
						Arguments
					</span>
					{args.length > 0 ? (
						<pre className="max-h-48 overflow-auto rounded bg-slate-100 p-2 font-mono text-[12px] text-slate-800 dark:bg-slate-900 dark:text-slate-200">
							{args}
						</pre>
					) : (
						<span className="text-xs italic text-slate-400 dark:text-slate-500">
							(no arguments)
						</span>
					)}
				</div>
				<div className="flex flex-col gap-1">
					<span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
						Result
					</span>
					{running ? (
						<span
							className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
							data-testid="tool-call-running"
						>
							<Loader2
								className="h-3.5 w-3.5 animate-spin"
								aria-hidden="true"
							/>
							Running…
						</span>
					) : (
						<div className="min-w-0 break-words rounded bg-white p-2 text-[13px] dark:bg-slate-900">
							<MarkdownContent
								content={card.result ?? ""}
								workspaceId={workspaceId}
							/>
						</div>
					)}
				</div>
			</div>
		</details>
	);
}

function ToolStatusBadge({ running }: { running: boolean }) {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
				running
					? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
					: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
			)}
		>
			{running ? "Running" : "Done"}
		</span>
	);
}

/**
 * The list of tool-call cards for the in-flight turn. Rendered above the
 * live token preview so the transcript reads: tool calls (with results)
 * then the model's final answer streaming in.
 */
export function ToolCallCardList({
	cards,
	workspaceId,
}: {
	cards: readonly ToolCardState[];
	workspaceId: string;
}) {
	if (cards.length === 0) return null;
	return (
		<li
			className="flex flex-col gap-2 self-start w-full min-w-0"
			data-testid="tool-call-card-list"
		>
			{cards.map((card) => (
				<ToolCallCard key={card.id} card={card} workspaceId={workspaceId} />
			))}
		</li>
	);
}
