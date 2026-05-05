import { ExternalLink, FileText, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import {
	type ChunkRef,
	parseChunkMap,
} from "@/components/chat/MarkdownContent";
import { DocumentDetailDialog } from "@/components/workspaces/DocumentDetailDialog";
import { useDocumentChunks, useDocuments } from "@/hooks/useDocuments";
import type { ChatMessage, RagDocumentRecord } from "@/lib/schemas";
import { cn } from "@/lib/utils";

interface RetrievedContextPanelProps {
	readonly workspaceId: string;
	/** All persisted messages in the active conversation, ordered oldest-first. */
	readonly messages: readonly ChatMessage[];
	readonly className?: string;
}

interface SelectedChunk {
	readonly kbId: string;
	readonly documentId: string;
	readonly chunkId: string;
}

/**
 * Right-rail panel showing the chunks the agent grounded on for the
 * **most recent assistant turn**. Each cited chunk is fetched from
 * its KB-document chunk listing so the user sees the actual source
 * text instead of just an opaque chunk id.
 *
 * The fetch path is per-document (not per-chunk) because the runtime
 * only exposes `GET /knowledge-bases/{kb}/documents/{d}/chunks`. We
 * group chunks by `(kbId, documentId)`, fire one query per
 * document, and pluck the matching chunks out of the result.
 *
 * Chunks whose `documentId` is `null` (legacy `context_document_ids`
 * citations carry only the chunk id) render as a plain id pill —
 * the runtime can't link those to a document, and synthesizing a
 * preview would lie about provenance.
 *
 * Three states:
 *  - **No assistant turn yet**: empty-state copy nudges the user to
 *    send a message.
 *  - **Assistant turn with no citations**: explicit copy ("This turn
 *    didn't draw on the knowledge base") so the user understands
 *    *why* the panel is empty rather than guessing the panel is
 *    broken.
 *  - **Assistant turn with citations**: grouped per-document cards.
 *    Clicking a chunk or the "Open" link opens the same
 *    {@link DocumentDetailDialog} the KB explorer uses, overlaid on
 *    top of the chat — staying in chat avoids the jarring
 *    navigation-away the deep-link version produced.
 *
 * The chunk list is height-capped with internal overflow scroll so
 * a heavily-cited turn doesn't push the chat composer off screen.
 */
export function RetrievedContextPanel({
	workspaceId,
	messages,
	className,
}: RetrievedContextPanelProps) {
	const lastAssistant = useMemo(
		() => [...messages].reverse().find((m) => m.role === "agent") ?? null,
		[messages],
	);
	const chunkMap = useMemo(
		() => (lastAssistant ? parseChunkMap(lastAssistant.metadata) : new Map()),
		[lastAssistant],
	);

	// Group chunks by (kbId, documentId). Chunks without a documentId
	// land in their own bucket keyed `${kbId}:` so they still render
	// (just without a per-document subsection title).
	const groups = useMemo(() => {
		const out = new Map<string, ChunkRef[]>();
		for (const ref of chunkMap.values() as Iterable<ChunkRef>) {
			const key = `${ref.knowledgeBaseId}:${ref.documentId ?? ""}`;
			const existing = out.get(key);
			if (existing) existing.push(ref);
			else out.set(key, [ref]);
		}
		return out;
	}, [chunkMap]);

	// Selected chunk → drives the overlay dialog. Cleared on close.
	const [selected, setSelected] = useState<SelectedChunk | null>(null);

	return (
		// `overflow-hidden` lets the panel fill its (fixed) grid-row
		// height without spilling content outside the row; the inner
		// chunks list owns the scroll.
		<aside
			aria-label="Retrieved context for the latest assistant turn"
			className={cn(
				"flex flex-col gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white p-4",
				className,
			)}
		>
			<header className="flex items-center gap-2">
				<span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">
					<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
				</span>
				<div className="min-w-0">
					<h2 className="text-sm font-semibold text-slate-900">
						Retrieved context
					</h2>
					<p className="text-[11px] text-slate-500">
						Chunks the agent grounded on this turn.
					</p>
				</div>
			</header>

			{lastAssistant === null ? (
				<EmptyState
					icon={<Search className="h-4 w-4" aria-hidden="true" />}
					title="Send a message to see what the agent retrieved."
				/>
			) : groups.size === 0 ? (
				<EmptyState
					icon={<Search className="h-4 w-4" aria-hidden="true" />}
					title="This turn didn't draw on the knowledge base."
					description="The agent answered without retrieving any chunks. RAG runs only on turns that need grounding."
				/>
			) : (
				// Fill the panel's available height; scroll internally so the
				// outer aside stays bounded by the chat layout's fixed grid
				// row. `min-h-0` is the standard flex-child fix that lets
				// `flex-1` actually shrink instead of being floored at the
				// content's intrinsic height.
				<ul
					className="flex flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5 min-h-0"
					data-testid="context-panel-groups"
				>
					{[...groups.entries()].map(([groupKey, refs]) => {
						const sample = refs[0];
						if (!sample) return null;
						return (
							<DocumentGroup
								key={groupKey}
								workspaceId={workspaceId}
								kbId={sample.knowledgeBaseId}
								documentId={sample.documentId}
								refs={refs}
								onSelectChunk={setSelected}
							/>
						);
					})}
				</ul>
			)}

			{selected ? (
				<ContextDocumentDialog
					workspaceId={workspaceId}
					selected={selected}
					onClose={() => setSelected(null)}
				/>
			) : null}
		</aside>
	);
}

interface DocumentGroupProps {
	readonly workspaceId: string;
	readonly kbId: string;
	readonly documentId: string | null;
	readonly refs: readonly ChunkRef[];
	readonly onSelectChunk: (selected: SelectedChunk) => void;
}

function DocumentGroup({
	workspaceId,
	kbId,
	documentId,
	refs,
	onSelectChunk,
}: DocumentGroupProps) {
	// Only fetch when we have a documentId. Legacy citations carry just
	// the chunk id and have no document to query.
	const chunks = useDocumentChunks(
		workspaceId,
		kbId || undefined,
		documentId ?? undefined,
		// Cap the page size — context-panel chunks are inline previews,
		// not the full document. 200 is the default explorer cap; tighter
		// here keeps memory + bandwidth proportional to what's shown.
		{ enabled: Boolean(documentId), limit: 200 },
	);
	const chunkTexts = useMemo(() => {
		const out = new Map<string, string | null>();
		if (!chunks.data) return out;
		for (const c of chunks.data) {
			out.set(c.id, c.text);
		}
		return out;
	}, [chunks.data]);

	return (
		<li className="rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2.5">
			<div className="flex items-center justify-between gap-2 mb-1.5">
				<div className="flex items-center gap-1.5 min-w-0">
					<FileText
						className="h-3.5 w-3.5 shrink-0 text-slate-500"
						aria-hidden="true"
					/>
					<span className="truncate text-xs font-medium text-slate-700">
						{documentId ? (
							<DocumentTitle documentId={documentId} refsLen={refs.length} />
						) : (
							<span className="italic text-slate-500">
								Legacy citation (no document link)
							</span>
						)}
					</span>
				</div>
				{documentId ? (
					<button
						type="button"
						onClick={() =>
							// Open dialog at the document level — no specific chunk
							// to highlight; the user just wants the document in view.
							onSelectChunk({
								kbId,
								documentId,
								chunkId: refs[0]?.chunkId ?? "",
							})
						}
						className="inline-flex items-center gap-0.5 text-[11px] text-[var(--color-brand-700)] hover:underline"
						aria-label={`Open document ${documentId}`}
					>
						Open
						<ExternalLink className="h-3 w-3" aria-hidden="true" />
					</button>
				) : null}
			</div>
			<ul className="flex flex-col gap-1.5">
				{refs.map((ref) => {
					const text = chunkTexts.get(ref.chunkId) ?? null;
					const clickable = Boolean(ref.documentId);
					const inner = (
						<>
							<span className="font-mono text-[10px] text-slate-500">
								{ref.chunkId.slice(0, 12)}
								{ref.chunkId.length > 12 ? "…" : ""}
							</span>
							{text ? (
								<p className="mt-0.5 line-clamp-3">{text}</p>
							) : chunks.isLoading && documentId ? (
								<p className="mt-0.5 italic text-slate-400">Loading…</p>
							) : chunks.isError ? (
								<p className="mt-0.5 italic text-red-600">
									Couldn't load chunk preview.
								</p>
							) : (
								<p className="mt-0.5 italic text-slate-400">
									No preview available.
								</p>
							)}
						</>
					);
					return (
						<li key={ref.chunkId} className="min-w-0">
							{clickable ? (
								<button
									type="button"
									onClick={() =>
										onSelectChunk({
											kbId: ref.knowledgeBaseId,
											documentId: ref.documentId as string,
											chunkId: ref.chunkId,
										})
									}
									className="block w-full text-left rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] leading-snug text-slate-700 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]"
								>
									{inner}
								</button>
							) : (
								// Legacy citation — chunk id only, no document to
								// open. Render a non-interactive card.
								<div className="block rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] leading-snug text-slate-700">
									{inner}
								</div>
							)}
						</li>
					);
				})}
			</ul>
		</li>
	);
}

function DocumentTitle({
	documentId,
	refsLen,
}: {
	documentId: string;
	refsLen: number;
}) {
	// We don't have a `getDocument` endpoint; the document name lives
	// in the workspace-wide listing which the panel doesn't fetch
	// proactively. Showing the truncated documentId keeps the link
	// semantics honest without prefetching every cited document — the
	// dialog overlay shows the full filename / size / status once the
	// user clicks through.
	return (
		<>
			<span className="font-mono text-slate-700">
				{documentId.slice(0, 12)}
				{documentId.length > 12 ? "…" : ""}
			</span>
			<span className="ml-1 text-slate-500">
				· {refsLen} {refsLen === 1 ? "chunk" : "chunks"}
			</span>
		</>
	);
}

interface ContextDocumentDialogProps {
	readonly workspaceId: string;
	readonly selected: SelectedChunk;
	readonly onClose: () => void;
}

/**
 * Wrapper around {@link DocumentDetailDialog} that resolves a
 * {@link RagDocumentRecord} from the document-list cache before
 * opening the dialog. Documents are listed per-KB; we fetch lazily
 * on first open per (workspace, KB) pair, and TanStack Query dedupes
 * with the KB-explorer's own list so a user who already visited the
 * explorer pays no extra round trip.
 *
 * If the document isn't found in the list (e.g. it was deleted
 * between the chat turn and the click), the dialog stays closed and
 * the panel restores its no-selection state.
 */
function ContextDocumentDialog({
	workspaceId,
	selected,
	onClose,
}: ContextDocumentDialogProps) {
	const docs = useDocuments(workspaceId, selected.kbId);
	const doc: RagDocumentRecord | null =
		docs.data?.find((d) => d.documentId === selected.documentId) ?? null;
	return (
		<DocumentDetailDialog
			workspace={workspaceId}
			knowledgeBaseId={selected.kbId}
			doc={doc}
			highlightChunkId={selected.chunkId || null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		/>
	);
}

function EmptyState({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode;
	title: string;
	description?: string;
}) {
	return (
		<div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-slate-200 bg-slate-50/40 px-3 py-4 text-center">
			<span className="text-slate-400">{icon}</span>
			<p className="text-xs font-medium text-slate-700">{title}</p>
			{description ? (
				<p className="text-[11px] text-slate-500">{description}</p>
			) : null}
		</div>
	);
}
