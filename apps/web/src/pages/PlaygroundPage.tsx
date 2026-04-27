import { Plus, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
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
import { CreateKnowledgeBaseDialog } from "@/components/workspaces/CreateKnowledgeBaseDialog";
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases";
import { usePlaygroundSearch } from "@/hooks/usePlaygroundSearch";
import { useEmbeddingServices } from "@/hooks/useServices";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { formatApiError, type PlaygroundSearchInput } from "@/lib/api";
import type {
	EmbeddingServiceRecord,
	KnowledgeBaseRecord,
	SearchHit,
	Workspace,
} from "@/lib/schemas";

/**
 * The playground.
 *
 * Flow:
 *   1. pick a workspace → we load its knowledge bases
 *   2. pick a knowledge base → the query form enables
 *   3. submit a text or vector query → POST /search → render hits
 *
 * Routing is pure client-side; no persistence. Query results live
 * only in component state (this is a scratchpad, not a saved view).
 */
export function PlaygroundPage() {
	const workspacesQuery = useWorkspaces();
	const [workspaceUid, setWorkspaceUid] = useState<string>("");
	const [knowledgeBaseUid, setKnowledgeBaseUid] = useState<string>("");
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
				<div className="flex items-start gap-3">
					<span className="brand-tile" aria-hidden>
						<Sparkles className="h-5 w-5" />
					</span>
					<div>
						<h1 className="text-2xl font-semibold tracking-tight text-slate-900">
							Playground
						</h1>
						<p className="mt-1 text-sm text-slate-600">
							Run vector or text queries against a workspace's knowledge base
							and inspect the top hits. No state is saved — this is a
							scratchpad.
						</p>
					</div>
				</div>
			</div>

			<WorkspaceKbSelect
				workspaces={workspaces}
				workspaceUid={workspaceUid}
				setWorkspaceUid={(v) => {
					setWorkspaceUid(v);
					setKnowledgeBaseUid("");
					setHits(null);
				}}
				knowledgeBaseUid={knowledgeBaseUid}
				setKnowledgeBaseUid={(v) => {
					setKnowledgeBaseUid(v);
					setHits(null);
				}}
			/>

			<SearchPanel
				workspaceUid={workspaceUid}
				knowledgeBaseUid={knowledgeBaseUid}
				hits={hits}
				setHits={setHits}
			/>
		</div>
	);
}

function WorkspaceKbSelect({
	workspaces,
	workspaceUid,
	setWorkspaceUid,
	knowledgeBaseUid,
	setKnowledgeBaseUid,
}: {
	workspaces: Workspace[];
	workspaceUid: string;
	setWorkspaceUid: (v: string) => void;
	knowledgeBaseUid: string;
	setKnowledgeBaseUid: (v: string) => void;
}) {
	const kbQuery = useKnowledgeBases(workspaceUid || undefined);
	const knowledgeBases = kbQuery.data ?? [];
	const [createOpen, setCreateOpen] = useState(false);
	const isEmpty =
		Boolean(workspaceUid) && !kbQuery.isLoading && knowledgeBases.length === 0;

	return (
		<div className="flex flex-col gap-3">
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="pg-workspace">Workspace</Label>
					<Select value={workspaceUid} onValueChange={setWorkspaceUid}>
						<SelectTrigger id="pg-workspace" aria-label="Workspace">
							<SelectValue placeholder="Select a workspace" />
						</SelectTrigger>
						<SelectContent>
							{workspaces.map((w) => (
								<SelectItem key={w.workspaceId} value={w.workspaceId}>
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
					<Label htmlFor="pg-kb">Knowledge base</Label>
					<Select
						value={knowledgeBaseUid}
						onValueChange={setKnowledgeBaseUid}
						disabled={!workspaceUid || knowledgeBases.length === 0}
					>
						<SelectTrigger id="pg-kb" aria-label="Knowledge base">
							<SelectValue
								placeholder={
									!workspaceUid
										? "Pick a workspace first"
										: kbQuery.isLoading
											? "Loading…"
											: knowledgeBases.length === 0
												? "No knowledge bases yet — create one"
												: "Select a knowledge base"
								}
							/>
						</SelectTrigger>
						<SelectContent>
							{knowledgeBases.map((kb) => (
								<SelectItem key={kb.knowledgeBaseId} value={kb.knowledgeBaseId}>
									{kb.name}{" "}
									<span className="text-xs text-slate-500 font-mono ml-1">
										{kb.status}
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{isEmpty ? (
				<div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/80 px-4 py-3">
					<p className="text-sm text-slate-600">
						This workspace has no knowledge bases yet. Create one to start
						querying.
					</p>
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="sm" asChild>
							<Link to={`/workspaces/${workspaceUid}`}>Manage</Link>
						</Button>
						<Button
							variant="brand"
							size="sm"
							onClick={() => setCreateOpen(true)}
						>
							<Plus className="h-4 w-4" /> New knowledge base
						</Button>
					</div>
				</div>
			) : null}

			{workspaceUid ? (
				<CreateKnowledgeBaseDialog
					workspace={workspaceUid}
					open={createOpen}
					onOpenChange={setCreateOpen}
				/>
			) : null}
		</div>
	);
}

function SearchPanel({
	workspaceUid,
	knowledgeBaseUid,
	hits,
	setHits,
}: {
	workspaceUid: string;
	knowledgeBaseUid: string;
	hits: SearchHit[] | null;
	setHits: (h: SearchHit[] | null) => void;
}) {
	const kbQuery = useKnowledgeBases(workspaceUid || undefined);
	const embeddings = useEmbeddingServices(workspaceUid || undefined);
	const knowledgeBase: KnowledgeBaseRecord | undefined = kbQuery.data?.find(
		(k) => k.knowledgeBaseId === knowledgeBaseUid,
	);
	const embedding: EmbeddingServiceRecord | undefined =
		knowledgeBase &&
		embeddings.data?.find(
			(e) => e.embeddingServiceId === knowledgeBase.embeddingServiceId,
		);
	const search = usePlaygroundSearch();

	async function run(input: PlaygroundSearchInput) {
		if (!workspaceUid || !knowledgeBaseUid) return;
		try {
			const out = await search.mutateAsync({
				workspace: workspaceUid,
				knowledgeBase: knowledgeBaseUid,
				input,
			});
			setHits(out);
			if (out.length === 0) {
				toast.info("No matches", {
					description:
						"The query ran but the KB returned no hits. Check the filter, topK, or what's been ingested.",
				});
			}
		} catch (err) {
			toast.error("Search failed", { description: formatApiError(err) });
		}
	}

	if (!workspaceUid || !knowledgeBaseUid || !knowledgeBase) {
		return (
			<EmptyState
				title="Pick a workspace and knowledge base to query"
				description="The query form unlocks once both are selected."
			/>
		);
	}

	if (!embedding) {
		return <LoadingState label="Loading KB's embedding service…" />;
	}

	return (
		<div className="flex flex-col gap-6">
			<QueryForm
				target={{
					vectorDimension: embedding.embeddingDimension,
					embeddingProvider: `${embedding.provider}:${embedding.modelName}`,
					lexicalSupported: knowledgeBase.lexical.enabled,
					rerankSupported: knowledgeBase.rerankingServiceId !== null,
				}}
				onRun={run}
				pending={search.isPending}
			/>
			<ResultsTable hits={hits} loading={search.isPending} />
		</div>
	);
}
