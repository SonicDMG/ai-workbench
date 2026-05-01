import { ChunkingSubpanel } from "./ChunkingSubpanel";
import { EmbeddingSubpanel } from "./EmbeddingSubpanel";
import { RerankingSubpanel } from "./RerankingSubpanel";

/**
 * Workspace-scoped panel for the three execution-service surfaces.
 * Chunking, embedding, and reranking sit alongside each other because
 * a knowledge base composes one of each at create time.
 *
 * Each subpanel is a self-contained list/create/delete unit; shared
 * shells (`ServiceCard`, `ServiceRow`, `PresetPicker`,
 * `SelectWithCustom`, `Field`) live in `ServicesPanelHelpers.tsx`.
 */
export function ServicesPanel({ workspace }: { workspace: string }) {
	return (
		<div className="flex flex-col gap-4">
			<p className="text-xs text-slate-500">
				Chunkers, embedders, and rerankers a knowledge base can bind to. A KB
				composes exactly one chunking + one embedding service at create time,
				plus an optional reranker.
			</p>
			<EmbeddingSubpanel workspace={workspace} />
			<ChunkingSubpanel workspace={workspace} />
			<RerankingSubpanel workspace={workspace} />
		</div>
	);
}
