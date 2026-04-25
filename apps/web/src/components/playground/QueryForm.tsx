import { Play } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PlaygroundSearchInput } from "@/lib/api";
import type { VectorStoreRecord } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type Tab = "text" | "vector";

/**
 * Playground query input.
 *
 * Text tab sends `{ text }`; the backend picks the server-side
 * embedding path when the driver supports it and falls back to
 * client-side embedding via the store's `embedding` config.
 * Vector tab sends `{ vector }` directly — expects a JSON array of
 * numbers with length == `vs.vectorDimension`.
 *
 * Filter input is a JSON textarea. Empty means no filter. We parse
 * on submit and surface a clear message inline if it's invalid
 * rather than posting a broken body.
 */
export function QueryForm({
	vectorStore,
	onRun,
	pending,
}: {
	vectorStore: VectorStoreRecord;
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

	const lexicalSupported = vectorStore.lexical.enabled;
	const rerankSupported = vectorStore.reranking.enabled;

	function submit() {
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
				return;
			}
		}
		if (tab === "text") {
			if (text.trim().length === 0) {
				setError("text is required");
				return;
			}
			onRun({
				topK,
				filter,
				text: text.trim(),
				...(hybrid && { hybrid: true, lexicalWeight }),
				...(rerank && { rerank: true }),
			});
			return;
		}
		if (hybrid || rerank) {
			setError(
				"hybrid and rerank require a text query — switch to the Text tab or clear the toggles",
			);
			return;
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
			return;
		}
		if (vec.length !== vectorStore.vectorDimension) {
			setError(
				`vector length ${vec.length} doesn't match store dimension ${vectorStore.vectorDimension}`,
			);
			return;
		}
		onRun({ topK, filter, vector: vec });
	}

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col gap-4">
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
					<Label htmlFor="pg-text">Query</Label>
					<textarea
						id="pg-text"
						className="min-h-[96px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:border-[var(--color-brand-500)]"
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="e.g. a blue sweater for cold weather"
					/>
					<p className="text-xs text-slate-500">
						The runtime embeds via the vector store's configured provider (
						<span className="font-mono">{vectorStore.embedding.provider}</span>)
						when the backend can't do it server-side.
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="pg-vec">
						Vector ({vectorStore.vectorDimension} floats)
					</Label>
					<textarea
						id="pg-vec"
						className="min-h-[96px] rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-mono shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:border-[var(--color-brand-500)]"
						value={vectorStr}
						onChange={(e) => setVectorStr(e.target.value)}
						placeholder={`[0.12, -0.05, …]  // length ${vectorStore.vectorDimension}`}
					/>
				</div>
			)}

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="pg-topk">Top-K ({topK})</Label>
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
					<Label htmlFor="pg-filter">Filter (JSON object, optional)</Label>
					<textarea
						id="pg-filter"
						className="min-h-[64px] rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-mono shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:border-[var(--color-brand-500)]"
						value={filterStr}
						onChange={(e) => setFilterStr(e.target.value)}
						placeholder='{"category": "apparel"}'
					/>
				</div>
			</div>

			<div className="flex flex-col gap-3 border-t border-slate-100 pt-3 text-sm">
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
							<Label htmlFor="pg-lexweight">
								Lexical weight ({lexicalWeight.toFixed(2)})
							</Label>
							<span className="text-xs text-slate-400">
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
						<p className="text-xs text-slate-500">
							Mix between vector and lexical scores in the hybrid combination.
							Mock driver respects this directly; Astra's native{" "}
							<code className="font-mono">findAndRerank</code> ignores it (the
							reranker owns the blend).
						</p>
					</div>
				) : null}
			</div>

			{error ? (
				<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
					{error}
				</div>
			) : null}

			<div className="flex items-center justify-end gap-2">
				<Button variant="brand" onClick={submit} disabled={pending}>
					<Play className="h-4 w-4" />
					{pending ? "Running…" : "Run query"}
				</Button>
			</div>
		</div>
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
			className="inline-flex items-start gap-2 cursor-pointer text-sm text-slate-700"
		>
			<input
				id={id}
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--color-brand-600)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
			/>
			<span className="flex flex-col">
				<span className="font-medium">{label}</span>
				<span className="text-xs text-slate-500">{description}</span>
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
					? "bg-slate-900 text-white"
					: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
			)}
		>
			{children}
		</button>
	);
}
