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
	const [error, setError] = useState<string | null>(null);

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
			onRun({ topK, filter, text: text.trim() });
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
