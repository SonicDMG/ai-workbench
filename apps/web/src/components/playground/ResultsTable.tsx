import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { SearchHit } from "@/lib/schemas";

/**
 * Renders search hits.
 *
 * Each hit is a **chunk** under a document — the playground shows
 * chunk-level rows because that's the resolution the vector store
 * indexes at. When the ingest pipeline stamps `chunkText`,
 * `documentUid`, and `chunkIndex` into the payload (it does, by
 * default), we surface them in the row so the chunk → document
 * relationship is visible without expanding.
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
				<span>Chunk</span>
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
	const payload = (hit.payload ?? {}) as Record<string, unknown>;
	const chunkIndex =
		typeof payload.chunkIndex === "number" ? payload.chunkIndex : null;
	const chunkText =
		typeof payload.chunkText === "string" ? payload.chunkText : null;
	const documentUid =
		typeof payload.documentUid === "string" ? payload.documentUid : null;
	return (
		<li>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="grid w-full grid-cols-[24px,1fr,96px] items-start gap-4 px-4 py-3 text-left hover:bg-slate-50"
			>
				{open ? (
					<ChevronDown className="h-4 w-4 text-slate-500 mt-0.5" aria-hidden />
				) : (
					<ChevronRight className="h-4 w-4 text-slate-500 mt-0.5" aria-hidden />
				)}
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						{chunkIndex !== null ? (
							<span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 tabular-nums shrink-0">
								#{chunkIndex}
							</span>
						) : null}
						<span className="font-mono text-xs text-slate-500 truncate">
							{documentUid ?? hit.id}
						</span>
					</div>
					{chunkText ? (
						<p className="mt-1 line-clamp-2 text-sm text-slate-800">
							{chunkText}
						</p>
					) : (
						<p className="mt-1 text-xs text-slate-400 italic">
							(text not stored on this chunk's payload — older ingest)
						</p>
					)}
				</div>
				<span className="text-right font-mono text-sm text-slate-600 mt-0.5">
					{hit.score.toFixed(4)}
				</span>
			</button>
			{open ? (
				<div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
					<pre className="overflow-auto rounded-md border border-slate-200 bg-white p-3 text-xs font-mono text-slate-800">
						{JSON.stringify(
							{ id: hit.id, payload: hit.payload ?? {}, score: hit.score },
							null,
							2,
						)}
					</pre>
				</div>
			) : null}
		</li>
	);
}
