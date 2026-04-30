import { ArrowLeft, Database, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/common/states";
import { QueryForm } from "@/components/playground/QueryForm";
import { ResultsTable } from "@/components/playground/ResultsTable";
import { Button } from "@/components/ui/button";
import { useKnowledgeBase } from "@/hooks/useKnowledgeBases";
import { usePlaygroundSearch } from "@/hooks/usePlaygroundSearch";
import { useEmbeddingServices } from "@/hooks/useServices";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { formatApiError, type PlaygroundSearchInput } from "@/lib/api";
import type { EmbeddingServiceRecord, SearchHit } from "@/lib/schemas";

/**
 * The playground.
 *
 * The playground is scoped to a single KB route:
 * `/workspaces/:workspaceId/knowledge-bases/:knowledgeBaseId/playground`.
 * The containing route supplies the workspace + KB context, so there
 * are no selectors here.
 *
 * Routing is pure client-side; no persistence. Query results live
 * only in component state (this is a scratchpad, not a saved view).
 */
export function PlaygroundPage() {
	const params = useParams<{
		workspaceId: string;
		knowledgeBaseId: string;
	}>();
	const workspaceId = params.workspaceId;
	const knowledgeBaseId = params.knowledgeBaseId;
	const workspace = useWorkspace(workspaceId);
	const knowledgeBase = useKnowledgeBase(workspaceId, knowledgeBaseId);
	const [hits, setHits] = useState<SearchHit[] | null>(null);

	if (!workspaceId || !knowledgeBaseId) return <Navigate to="/" replace />;

	if (workspace.isLoading || knowledgeBase.isLoading) {
		return <LoadingState label="Loading playground…" />;
	}
	if (workspace.isError) {
		return (
			<ErrorState
				title="Couldn't load workspace"
				message={workspace.error.message}
			/>
		);
	}
	if (knowledgeBase.isError || !knowledgeBase.data) {
		return (
			<ErrorState
				title="Couldn't load knowledge base"
				message={knowledgeBase.error?.message ?? "Knowledge base not found."}
				actions={
					<Button variant="secondary" asChild>
						<Link to={`/workspaces/${workspaceId}`}>
							<ArrowLeft className="h-4 w-4" /> Back to workspace
						</Link>
					</Button>
				}
			/>
		);
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
							Query{" "}
							<span className="font-medium">{knowledgeBase.data.name}</span> in{" "}
							<span className="font-medium">{workspace.data?.name}</span>. No
							state is saved — this is a scratchpad.
						</p>
					</div>
				</div>
				<Button variant="secondary" size="sm" asChild>
					<Link
						to={`/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}`}
					>
						<Database className="h-4 w-4" /> Knowledge base
					</Link>
				</Button>
			</div>

			<SearchPanel
				workspaceId={workspaceId}
				knowledgeBaseId={knowledgeBaseId}
				embeddingServiceId={knowledgeBase.data.embeddingServiceId}
				lexicalSupported={knowledgeBase.data.lexical.enabled}
				rerankSupported={knowledgeBase.data.rerankingServiceId !== null}
				hits={hits}
				setHits={setHits}
			/>
		</div>
	);
}

function SearchPanel({
	workspaceId,
	knowledgeBaseId,
	embeddingServiceId,
	lexicalSupported,
	rerankSupported,
	hits,
	setHits,
}: {
	workspaceId: string;
	knowledgeBaseId: string;
	embeddingServiceId: string;
	lexicalSupported: boolean;
	rerankSupported: boolean;
	hits: SearchHit[] | null;
	setHits: (h: SearchHit[] | null) => void;
}) {
	const embeddings = useEmbeddingServices(workspaceId);
	const embedding: EmbeddingServiceRecord | undefined = embeddings.data?.find(
		(e) => e.embeddingServiceId === embeddingServiceId,
	);
	const search = usePlaygroundSearch();

	async function run(input: PlaygroundSearchInput) {
		if (!workspaceId || !knowledgeBaseId) return;
		try {
			const out = await search.mutateAsync({
				workspace: workspaceId,
				knowledgeBase: knowledgeBaseId,
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

	if (!embedding) {
		return <LoadingState label="Loading KB's embedding service…" />;
	}

	return (
		<div className="flex flex-col gap-6">
			<QueryForm
				target={{
					vectorDimension: embedding.embeddingDimension,
					embeddingProvider: `${embedding.provider}:${embedding.modelName}`,
					lexicalSupported,
					rerankSupported,
				}}
				onRun={run}
				pending={search.isPending}
			/>
			<ResultsTable hits={hits} loading={search.isPending} />
		</div>
	);
}
