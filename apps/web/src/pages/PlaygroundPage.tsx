import { RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "@/components/common/states";
import { QueryForm } from "@/components/playground/QueryForm";
import { ResultsTable } from "@/components/playground/ResultsTable";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePlaygroundSearch } from "@/hooks/usePlaygroundSearch";
import { useVectorStores } from "@/hooks/useVectorStores";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { ApiError, type PlaygroundSearchInput } from "@/lib/api";
import type { SearchHit, VectorStoreRecord, Workspace } from "@/lib/schemas";

/**
 * The playground.
 *
 * Flow:
 *   1. pick a workspace → we load its vector stores
 *   2. pick a vector store → the query form enables
 *   3. submit a text or vector query → POST /search → render hits
 *
 * Routing is pure client-side; no persistence. Query results live
 * only in component state (this is a scratchpad, not a saved view).
 */
export function PlaygroundPage() {
	const workspacesQuery = useWorkspaces();
	const [workspaceUid, setWorkspaceUid] = useState<string>("");
	const [vectorStoreUid, setVectorStoreUid] = useState<string>("");
	const [hits, setHits] = useState<SearchHit[] | null>(null);

	if (workspacesQuery.isLoading)
		return <LoadingState label="Loading workspaces…" />;
	if (workspacesQuery.isError) {
		return (
			<ErrorState
				title="Couldn't load workspaces"
				message={workspacesQuery.error.message}
				actions={
					<Button variant="secondary" onClick={() => workspacesQuery.refetch()}>
						<RefreshCw className="h-4 w-4" /> Retry
					</Button>
				}
			/>
		);
	}
	const workspaces = workspacesQuery.data ?? [];
	if (workspaces.length === 0) {
		return <Navigate to="/onboarding" replace />;
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
						<Sparkles
							className="h-6 w-6 text-[var(--color-brand-600)]"
							aria-hidden
						/>
						Playground
					</h1>
					<p className="mt-1 text-sm text-slate-600">
						Run vector or text queries against a workspace's vector store and
						inspect the top hits. No state is saved — this is a scratchpad.
					</p>
				</div>
			</div>

			<WorkspaceVectorStoreSelect
				workspaces={workspaces}
				workspaceUid={workspaceUid}
				setWorkspaceUid={(v) => {
					setWorkspaceUid(v);
					setVectorStoreUid("");
					setHits(null);
				}}
				vectorStoreUid={vectorStoreUid}
				setVectorStoreUid={(v) => {
					setVectorStoreUid(v);
					setHits(null);
				}}
			/>

			<SearchPanel
				workspaceUid={workspaceUid}
				vectorStoreUid={vectorStoreUid}
				hits={hits}
				setHits={setHits}
			/>
		</div>
	);
}

function WorkspaceVectorStoreSelect({
	workspaces,
	workspaceUid,
	setWorkspaceUid,
	vectorStoreUid,
	setVectorStoreUid,
}: {
	workspaces: Workspace[];
	workspaceUid: string;
	setWorkspaceUid: (v: string) => void;
	vectorStoreUid: string;
	setVectorStoreUid: (v: string) => void;
}) {
	const vsQuery = useVectorStores(workspaceUid || undefined);
	const vectorStores = vsQuery.data ?? [];

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="pg-workspace">Workspace</Label>
				<Select value={workspaceUid} onValueChange={setWorkspaceUid}>
					<SelectTrigger id="pg-workspace" aria-label="Workspace">
						<SelectValue placeholder="Select a workspace" />
					</SelectTrigger>
					<SelectContent>
						{workspaces.map((w) => (
							<SelectItem key={w.uid} value={w.uid}>
								{w.name}{" "}
								<span className="text-xs text-slate-500 font-mono ml-1">
									{w.kind}
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="pg-vs">Vector store</Label>
				<Select
					value={vectorStoreUid}
					onValueChange={setVectorStoreUid}
					disabled={!workspaceUid || vectorStores.length === 0}
				>
					<SelectTrigger id="pg-vs" aria-label="Vector store">
						<SelectValue
							placeholder={
								!workspaceUid
									? "Pick a workspace first"
									: vsQuery.isLoading
										? "Loading…"
										: vectorStores.length === 0
											? "No vector stores in this workspace"
											: "Select a vector store"
							}
						/>
					</SelectTrigger>
					<SelectContent>
						{vectorStores.map((vs) => (
							<SelectItem key={vs.uid} value={vs.uid}>
								{vs.name}{" "}
								<span className="text-xs text-slate-500 font-mono ml-1">
									dim {vs.vectorDimension}
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}

function SearchPanel({
	workspaceUid,
	vectorStoreUid,
	hits,
	setHits,
}: {
	workspaceUid: string;
	vectorStoreUid: string;
	hits: SearchHit[] | null;
	setHits: (h: SearchHit[] | null) => void;
}) {
	const vsQuery = useVectorStores(workspaceUid || undefined);
	const vectorStore: VectorStoreRecord | undefined = vsQuery.data?.find(
		(v) => v.uid === vectorStoreUid,
	);
	const search = usePlaygroundSearch();

	async function run(input: PlaygroundSearchInput) {
		if (!workspaceUid || !vectorStoreUid) return;
		try {
			const out = await search.mutateAsync({
				workspace: workspaceUid,
				vectorStore: vectorStoreUid,
				input,
			});
			setHits(out);
			if (out.length === 0) {
				toast.info("No matches", {
					description:
						"The query ran but the store returned no hits. Check the filter, topK, or the data you've upserted.",
				});
			}
		} catch (err) {
			const msg =
				err instanceof ApiError
					? `${err.code}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Unknown error";
			toast.error("Search failed", { description: msg });
		}
	}

	if (!workspaceUid || !vectorStoreUid || !vectorStore) {
		return (
			<EmptyState
				title="Pick a workspace and vector store to query"
				description="The query form unlocks once both are selected."
			/>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<QueryForm
				vectorStore={vectorStore}
				onRun={run}
				pending={search.isPending}
			/>
			<ResultsTable hits={hits} loading={search.isPending} />
		</div>
	);
}
