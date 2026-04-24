import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { SearchHit } from "@/lib/schemas";

/**
 * Renders search hits.
 *
 * Each row expands to show payload + score in full. When `hits` is
 * `null` the user hasn't run a query yet — we stay quiet. Empty
 * results show a small in-line empty state; the full toast is
 * emitted by the page so the user gets a clear signal even while
 * scrolled away from the table.
 */
export function ResultsTable({
	hits,
	loading,
}: {
	hits: readonly SearchHit[] | null;
	loading: boolean;
}) {
	if (hits === null && !loading) return null;

	if (loading && !hits) {
		return (
			<div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
				Searching…
			</div>
		);
	}

	if (hits && hits.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
				No matches.
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
			<div className="grid grid-cols-[24px,1fr,96px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-slate-500">
				<span />
				<span>ID</span>
				<span className="text-right">Score</span>
			</div>
			<ul className="divide-y divide-slate-100">
				{(hits ?? []).map((h) => (
					<ResultRow key={h.id} hit={h} />
				))}
			</ul>
		</div>
	);
}

function ResultRow({ hit }: { hit: SearchHit }) {
	const [open, setOpen] = useState(false);
	return (
		<li>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="grid w-full grid-cols-[24px,1fr,96px] items-center gap-4 px-4 py-3 text-left hover:bg-slate-50"
			>
				{open ? (
					<ChevronDown className="h-4 w-4 text-slate-500" aria-hidden />
				) : (
					<ChevronRight className="h-4 w-4 text-slate-500" aria-hidden />
				)}
				<span className="font-mono text-sm text-slate-900 truncate">
					{hit.id}
				</span>
				<span className="text-right font-mono text-sm text-slate-600">
					{hit.score.toFixed(4)}
				</span>
			</button>
			{open ? (
				<div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
					<pre className="overflow-auto rounded-md border border-slate-200 bg-white p-3 text-xs font-mono text-slate-800">
						{JSON.stringify(
							{ payload: hit.payload ?? {}, score: hit.score },
							null,
							2,
						)}
					</pre>
				</div>
			) : null}
		</li>
	);
}
