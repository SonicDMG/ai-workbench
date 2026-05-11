import { Copy, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AstraCodeChip } from "@/components/astra/AstraCodeChip";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import type { PlaygroundSearchInput } from "@/lib/api";
import { getAuthToken } from "@/lib/authToken";
import { formatCurl } from "@/lib/curl";
import type { AstraQuerySnapshot, Workspace } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type Tab = "text" | "vector";

export interface QueryFormTarget {
	readonly vectorDimension: number;
	readonly embeddingProvider: string;
	readonly lexicalSupported: boolean;
	readonly rerankSupported: boolean;
	/** Workspace + KB metadata used by the preview chip. `null` when
	 * the workspace info hasn't loaded yet — the chip simply doesn't
	 * render until the data is ready. */
	readonly workspace: Workspace | null;
	readonly knowledgeBaseName: string;
	readonly vectorCollection: string | null;
}

/**
 * Playground query input.
 *
 * Text tab sends `{ text }`; the backend picks the server-side
 * embedding path when the driver supports it and falls back to
 * client-side embedding via the KB's bound embedding service.
 * Vector tab sends `{ vector }` directly — expects a JSON array of
 * numbers with length == `target.vectorDimension`.
 *
 * Filter input is a JSON textarea. Empty means no filter. We parse
 * on submit and surface a clear message inline if it's invalid
 * rather than posting a broken body.
 */
export function QueryForm({
	target,
	workspaceId,
	knowledgeBaseId,
	onRun,
	pending,
}: {
	target: QueryFormTarget;
	/** Used by the Copy-as-cURL button to build the request URL. */
	workspaceId: string;
	knowledgeBaseId: string;
	onRun: (input: PlaygroundSearchInput) => void;
	pending: boolean;
}) {
	const [tab, setTab] = useState<Tab>("text");
	const [text, setText] = useState("");
	const [vectorStr, setVectorStr] = useState("");
	const [topK, setTopK] = useState(10);
	const [filterStr, setFilterStr] = useState("");
	const [hybrid, setHybrid] = useState(false);
	const [lexicalWeight, setLexicalWeight] = useState(0.5);
	const [rerank, setRerank] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const lexicalSupported = target.lexicalSupported;
	const rerankSupported = target.rerankSupported;

	/**
	 * Validate the form state and produce the same `PlaygroundSearchInput`
	 * the run handler would post. Both `submit` and the Copy-as-cURL
	 * button consume this so the cURL is a faithful reproduction of
	 * what Run would actually send.
	 *
	 * Returns `null` when the form is invalid; the appropriate error
	 * message has already been written to `error` state via `setError`.
	 */
	function buildSearchInput(): PlaygroundSearchInput | null {
		setError(null);
		let filter: Record<string, unknown> | undefined;
		if (filterStr.trim().length > 0) {
			try {
				const parsed = JSON.parse(filterStr);
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
					throw new Error("filter must be a JSON object");
				}
				filter = parsed as Record<string, unknown>;
			} catch (e) {
				setError(
					`filter is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
				);
				return null;
			}
		}
		if (tab === "text") {
			if (text.trim().length === 0) {
				setError("text is required");
				return null;
			}
			return {
				topK,
				filter,
				text: text.trim(),
				...(hybrid && { hybrid: true, lexicalWeight }),
				...(rerank && { rerank: true }),
			};
		}
		if (hybrid || rerank) {
			setError(
				"hybrid and rerank require a text query — switch to the Text tab or clear the toggles",
			);
			return null;
		}
		let vec: number[];
		try {
			const parsed = JSON.parse(vectorStr);
			if (
				!Array.isArray(parsed) ||
				!parsed.every((n) => typeof n === "number")
			) {
				throw new Error("expected a JSON array of numbers");
			}
			vec = parsed;
		} catch (e) {
			setError(
				`vector is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
			);
			return null;
		}
		if (vec.length !== target.vectorDimension) {
			setError(
				`vector length ${vec.length} doesn't match store dimension ${target.vectorDimension}`,
			);
			return null;
		}
		return { topK, filter, vector: vec };
	}

	function submit() {
		const input = buildSearchInput();
		if (input) onRun(input);
	}

	async function copyAsCurl() {
		const input = buildSearchInput();
		if (!input) return;
		const origin = typeof window !== "undefined" ? window.location.origin : "";
		const token = getAuthToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers.Authorization = `Bearer ${token}`;
		const command = formatCurl({
			method: "POST",
			url: `${origin}/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/search`,
			headers,
			body: JSON.stringify(input),
		});
		try {
			await navigator.clipboard.writeText(command);
			toast.success("Copied as cURL", {
				description: token
					? "Includes your bearer token — paste with care."
					: "No bearer token attached. Add `-H 'Authorization: Bearer …'` if your runtime requires auth.",
			});
		} catch {
			toast.error("Couldn't copy to clipboard", {
				description: "Your browser blocked clipboard access.",
			});
		}
	}

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col gap-4 dark:border-slate-700 dark:bg-slate-900">
			<div className="flex items-center gap-1 text-sm">
				<TabButton active={tab === "text"} onClick={() => setTab("text")}>
					Text
				</TabButton>
				<TabButton active={tab === "vector"} onClick={() => setTab("vector")}>
					Vector
				</TabButton>
			</div>

			{tab === "text" ? (
				<div className="flex flex-col gap-1.5">
					<FieldLabel
						htmlFor="pg-text"
						help="Natural-language search text. The playground embeds this through the knowledge base's configured embedding service when needed."
					>
						Query
					</FieldLabel>
					<textarea
						id="pg-text"
						className="min-h-[96px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:border-[var(--color-brand-500)] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="e.g. a blue sweater for cold weather"
					/>
					<p className="text-xs text-slate-500 dark:text-slate-400">
						The runtime embeds via the KB's bound embedding service (
						<span className="font-mono">{target.embeddingProvider}</span>) when
						the backend can't do it server-side.
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-1.5">
					<FieldLabel
						htmlFor="pg-vec"
						help={`Raw vector search input. Paste a JSON array of numbers with exactly ${target.vectorDimension} values.`}
					>
						Vector ({target.vectorDimension} floats)
					</FieldLabel>
					<textarea
						id="pg-vec"
						className="min-h-[96px] rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-mono shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:border-[var(--color-brand-500)] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
						value={vectorStr}
						onChange={(e) => setVectorStr(e.target.value)}
						placeholder={`[0.12, -0.05, …]  // length ${target.vectorDimension}`}
					/>
				</div>
			)}

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<FieldLabel
						htmlFor="pg-topk"
						help="The maximum number of candidate matches to return. Higher values explore more results but can add latency."
					>
						Top-K ({topK})
					</FieldLabel>
					<Input
						id="pg-topk"
						type="range"
						min={1}
						max={25}
						value={topK}
						onChange={(e) => setTopK(Number(e.target.value))}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<FieldLabel
						htmlFor="pg-filter"
						help='Optional metadata filter as a JSON object, for example {"category":"apparel"}. Empty means no filter.'
					>
						Filter (JSON object, optional)
					</FieldLabel>
					<textarea
						id="pg-filter"
						className="min-h-[64px] rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-mono shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:border-[var(--color-brand-500)] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
						value={filterStr}
						onChange={(e) => setFilterStr(e.target.value)}
						placeholder='{"category": "apparel"}'
					/>
				</div>
			</div>

			<div className="flex flex-col gap-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
				<div className="flex flex-wrap items-center gap-4">
					<LaneToggle
						id="pg-hybrid"
						label="Hybrid"
						description={
							lexicalSupported
								? "Vector + lexical, combined by the driver."
								: "This vector store doesn't have lexical enabled — the driver will return 501."
						}
						checked={hybrid}
						onChange={setHybrid}
					/>
					<LaneToggle
						id="pg-rerank"
						label="Rerank"
						description={
							rerankSupported
								? "Reorder hits through the driver's reranker service."
								: "This vector store doesn't have reranking enabled — the driver will return 501."
						}
						checked={rerank}
						onChange={setRerank}
					/>
				</div>

				{hybrid ? (
					<div className="flex flex-col gap-1.5 pl-6">
						<div className="flex items-baseline justify-between">
							<FieldLabel
								htmlFor="pg-lexweight"
								help="Controls the hybrid blend. 0 favors vector similarity, 1 favors lexical matching, and 0.5 balances both."
							>
								Lexical weight ({lexicalWeight.toFixed(2)})
							</FieldLabel>
							<span className="text-xs text-slate-400 dark:text-slate-500">
								{lexicalWeight === 0
									? "vector-only"
									: lexicalWeight === 1
										? "lexical-only"
										: lexicalWeight < 0.5
											? "vector-leaning"
											: lexicalWeight > 0.5
												? "lexical-leaning"
												: "balanced"}
							</span>
						</div>
						<Input
							id="pg-lexweight"
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={lexicalWeight}
							onChange={(e) => setLexicalWeight(Number(e.target.value))}
						/>
						<p className="text-xs text-slate-500 dark:text-slate-400">
							Mix between vector and lexical scores in the hybrid combination.
							Mock driver respects this directly; Astra's native{" "}
							<code className="font-mono">findAndRerank</code> ignores it (the
							reranker owns the blend).
						</p>
					</div>
				) : null}
			</div>

			{error ? (
				<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
					{error}
				</div>
			) : null}

			<div className="flex items-center justify-end gap-2">
				{tab === "text" && text.trim().length > 0 ? (
					<PlaygroundVectorSearchPreview
						workspace={target.workspace}
						knowledgeBaseId={knowledgeBaseId}
						knowledgeBaseName={target.knowledgeBaseName}
						vectorCollection={target.vectorCollection}
						text={text}
						topK={topK}
					/>
				) : null}
				<Button
					variant="secondary"
					onClick={() => {
						void copyAsCurl();
					}}
					disabled={pending}
					title="Build the same request as cURL and copy it to your clipboard"
				>
					<Copy className="h-4 w-4" />
					Copy as cURL
				</Button>
				<Button variant="brand" onClick={submit} disabled={pending}>
					<Play className="h-4 w-4" />
					{pending ? "Running…" : "Run query"}
				</Button>
			</div>
		</div>
	);
}

/**
 * Preview chip rendered in the playground's action row alongside
 * `Copy as cURL` and `Run query`. Builds the `vector_search` snapshot
 * locally from form state — the call shape is deterministic, so a
 * server round-trip isn't required to know exactly what will run.
 *
 * Hidden when:
 *   - the workspace isn't Astra/HCD (no Data API call to render)
 *   - the KB has no bound `vectorCollection` (attach-mode KB whose
 *     collection field hasn't been backfilled, or pre-create state)
 *   - the workspace data hasn't loaded yet
 *
 * The chip's `preview` variant changes the trigger icon + dialog
 * copy so users understand they're inspecting the upcoming call,
 * not a record of a past one.
 */
function PlaygroundVectorSearchPreview({
	workspace,
	knowledgeBaseId,
	knowledgeBaseName,
	vectorCollection,
	text,
	topK,
}: {
	workspace: Workspace | null;
	knowledgeBaseId: string;
	knowledgeBaseName: string;
	vectorCollection: string | null;
	text: string;
	topK: number;
}) {
	if (!workspace) return null;
	if (workspace.kind !== "astra" && workspace.kind !== "hcd") return null;
	if (!vectorCollection) return null;
	const snapshot: AstraQuerySnapshot = {
		kind: "vector_search",
		knowledgeBaseId,
		kbName: knowledgeBaseName,
		collection: vectorCollection,
		keyspace: workspace.keyspace,
		query: { text, topK },
	};
	return (
		<AstraCodeChip
			snapshots={[snapshot]}
			variant="preview"
			dialogTitle="Astra vector_search call (preview)"
			dialogDescription={`The exact $vectorize-sorted find AI Workbench will run against ${vectorCollection} when you hit Run. Tokens and endpoint URLs are read from $ASTRA_DB_* env vars in the snippet.`}
			testId="playground-vector-search-preview-chip"
		/>
	);
}

function LaneToggle({
	id,
	label,
	description,
	checked,
	onChange,
}: {
	id: string;
	label: string;
	description: string;
	checked: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<label
			htmlFor={id}
			className="inline-flex items-start gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300"
		>
			<input
				id={id}
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--color-brand-600)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] dark:border-slate-600 dark:bg-slate-900"
			/>
			<span className="flex flex-col">
				<span className="font-medium">{label}</span>
				<span className="text-xs text-slate-500 dark:text-slate-400">
					{description}
				</span>
			</span>
		</label>
	);
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
				active
					? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
					: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
			)}
		>
			{children}
		</button>
	);
}
